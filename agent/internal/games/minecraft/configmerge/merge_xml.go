package configmerge

import (
	"bytes"
	"encoding/xml"
	"io"
	"strings"
)

// xmlNode is a simplified DOM node for template-safe XML merging.
type xmlNode struct {
	XMLName  xml.Name
	Attrs    []xml.Attr
	Children []*xmlNode
	CharData string
	Comments []string
}

func parseXMLDoc(content string) ([]*xmlNode, error) {
	decoder := xml.NewDecoder(strings.NewReader(content))
	var stack []*xmlNode
	var roots []*xmlNode
	for {
		tok, err := decoder.Token()
		if err == io.EOF {
			break
		}
		if err != nil {
			return nil, err
		}
		switch t := tok.(type) {
		case xml.StartElement:
			node := &xmlNode{XMLName: t.Name, Attrs: t.Attr}
			if len(stack) > 0 {
				parent := stack[len(stack)-1]
				parent.Children = append(parent.Children, node)
			} else {
				roots = append(roots, node)
			}
			stack = append(stack, node)
		case xml.EndElement:
			if len(stack) > 0 {
				stack = stack[:len(stack)-1]
			}
		case xml.CharData:
			text := strings.TrimSpace(string(t))
			if text != "" && len(stack) > 0 {
				stack[len(stack)-1].CharData = text
			}
		case xml.Comment:
			text := strings.TrimSpace(string(t))
			if text != "" && len(stack) > 0 {
				stack[len(stack)-1].Comments = append(stack[len(stack)-1].Comments, text)
			}
		}
	}
	return roots, nil
}

// xmlNodeKey produces a stable identity for matching nodes between template
// and live. Uses element name + key attributes (name, id, steamid, userid, key).
func xmlNodeKey(n *xmlNode) string {
	key := n.XMLName.Local
	for _, attr := range n.Attrs {
		lname := strings.ToLower(attr.Name.Local)
		if lname == "name" || lname == "id" || lname == "steamid" || lname == "userid" || lname == "key" {
			key += "|" + attr.Name.Local + "=" + attr.Value
			break
		}
	}
	return key
}

func serializeXML(roots []*xmlNode) string {
	var buf bytes.Buffer
	buf.WriteString("<?xml version=\"1.0\" encoding=\"utf-8\"?>\n")
	for _, root := range roots {
		writeXMLNode(&buf, root, 0)
	}
	return buf.String()
}

func writeXMLNode(buf *bytes.Buffer, n *xmlNode, indent int) {
	prefix := strings.Repeat("  ", indent)
	buf.WriteString(prefix)
	buf.WriteByte('<')
	buf.WriteString(n.XMLName.Local)
	for _, attr := range n.Attrs {
		buf.WriteByte(' ')
		buf.WriteString(attr.Name.Local)
		buf.WriteString(`="`)
		buf.WriteString(xmlEscapeAttr(attr.Value))
		buf.WriteByte('"')
	}
	if len(n.Children) == 0 && n.CharData == "" {
		buf.WriteString(" />\n")
		return
	}
	buf.WriteByte('>')
	if len(n.Children) == 0 {
		buf.WriteString(xmlEscapeText(n.CharData))
		buf.WriteString("</")
		buf.WriteString(n.XMLName.Local)
		buf.WriteString(">\n")
		return
	}
	buf.WriteByte('\n')
	for _, comment := range n.Comments {
		buf.WriteString(prefix)
		buf.WriteString("  <!-- ")
		buf.WriteString(comment)
		buf.WriteString(" -->\n")
	}
	for _, child := range n.Children {
		writeXMLNode(buf, child, indent+1)
	}
	buf.WriteString(prefix)
	buf.WriteString("</")
	buf.WriteString(n.XMLName.Local)
	buf.WriteString(">\n")
}

func xmlEscapeText(s string) string {
	s = strings.ReplaceAll(s, "&", "&amp;")
	s = strings.ReplaceAll(s, "<", "&lt;")
	s = strings.ReplaceAll(s, ">", "&gt;")
	return s
}

func xmlEscapeAttr(s string) string {
	s = xmlEscapeText(s)
	s = strings.ReplaceAll(s, "\"", "&quot;")
	return s
}

func mergeXML(path, templateContent, liveContent string) MergeResult {
	tmplRoots, err := parseXMLDoc(templateContent)
	if err != nil {
		return MergeResult{
			Path: path, MergedContent: templateContent, ParseFormat: "xml",
			Warning: "template XML parse failed: " + err.Error(), Skipped: true,
		}
	}
	liveRoots, err := parseXMLDoc(liveContent)
	if err != nil {
		return MergeResult{
			Path: path, MergedContent: templateContent, ParseFormat: "xml",
			Warning: "live XML parse failed: " + err.Error(), Skipped: true,
		}
	}

	stats := MergeStats{}
	// Build live index by key for each root
	liveIndex := buildXMLIndex(liveRoots)
	mergedRoots := mergeXMLNodes(tmplRoots, liveIndex, &stats)

	// Count dropped: nodes in live not matched by any template node
	countXMLDropped(liveRoots, tmplRoots, &stats)

	out := serializeXML(mergedRoots)
	return MergeResult{
		Path: path, MergedContent: out, ParseFormat: "xml", Stats: stats,
	}
}

func buildXMLIndex(nodes []*xmlNode) map[string]*xmlNode {
	index := make(map[string]*xmlNode, len(nodes))
	for _, n := range nodes {
		index[xmlNodeKey(n)] = n
		// Also index children for nested matching
		for _, child := range n.Children {
			childKey := xmlNodeKey(n) + "/" + xmlNodeKey(child)
			index[childKey] = child
		}
	}
	return index
}

func mergeXMLNodes(tmplNodes []*xmlNode, liveIndex map[string]*xmlNode, stats *MergeStats) []*xmlNode {
	result := make([]*xmlNode, 0, len(tmplNodes))
	for _, tmplNode := range tmplNodes {
		key := xmlNodeKey(tmplNode)
		liveNode, exists := liveIndex[key]
		merged := &xmlNode{
			XMLName:  tmplNode.XMLName,
			Attrs:    make([]xml.Attr, len(tmplNode.Attrs)),
			Comments: tmplNode.Comments,
		}
		copy(merged.Attrs, tmplNode.Attrs)

		if !exists {
			// Entirely new element in template
			merged.CharData = tmplNode.CharData
			merged.Children = tmplNode.Children
			stats.NewKeys++
			result = append(result, merged)
			continue
		}

		// Merge attributes: only carry live values for attrs that exist in template
		for i, tmplAttr := range merged.Attrs {
			lname := strings.ToLower(tmplAttr.Name.Local)
			// Identity attrs are kept from template
			if lname == "name" || lname == "id" || lname == "steamid" || lname == "userid" || lname == "key" {
				continue
			}
			for _, liveAttr := range liveNode.Attrs {
				if strings.EqualFold(liveAttr.Name.Local, tmplAttr.Name.Local) {
					if liveAttr.Value != tmplAttr.Value {
						stats.Carried++
					}
					merged.Attrs[i].Value = liveAttr.Value
					break
				}
			}
		}

		// Merge text content
		if len(tmplNode.Children) == 0 && tmplNode.CharData != "" {
			if liveNode.CharData != "" && liveNode.CharData != tmplNode.CharData {
				merged.CharData = liveNode.CharData
				stats.Carried++
			} else {
				merged.CharData = tmplNode.CharData
			}
		} else if len(tmplNode.Children) > 0 {
			// Recursively merge children
			childLiveIndex := make(map[string]*xmlNode, len(liveNode.Children))
			for _, liveChild := range liveNode.Children {
				childLiveIndex[xmlNodeKey(liveChild)] = liveChild
			}
			merged.Children = mergeXMLNodes(tmplNode.Children, childLiveIndex, stats)
		}

		result = append(result, merged)
	}
	return result
}

func countXMLDropped(liveNodes, tmplNodes []*xmlNode, stats *MergeStats) {
	tmplKeys := make(map[string]bool, len(tmplNodes))
	for _, n := range tmplNodes {
		tmplKeys[xmlNodeKey(n)] = true
	}
	for _, n := range liveNodes {
		if !tmplKeys[xmlNodeKey(n)] {
			stats.Dropped++
		} else {
			// Recurse into children
			var tmplChildren []*xmlNode
			for _, t := range tmplNodes {
				if xmlNodeKey(t) == xmlNodeKey(n) {
					tmplChildren = t.Children
					break
				}
			}
			countXMLDropped(n.Children, tmplChildren, stats)
		}
	}
}
