package minecraft

import "testing"

func TestParseListOutput(t *testing.T) {
	cases := []struct {
		in   string
		want []string
	}{
		{"There are 2 of a max of 20 players online: Alice, Bob", []string{"Alice", "Bob"}},
		{"There are 0 of a max of 20 players online:", nil},
		{"Players online: Carol", []string{"Carol"}},
	}
	for _, tc := range cases {
		got := parseListOutput(tc.in)
		if len(got) != len(tc.want) {
			t.Fatalf("%q: got %d players, want %d (%v)", tc.in, len(got), len(tc.want), got)
		}
		for i := range tc.want {
			if got[i]["name"] != tc.want[i] {
				t.Fatalf("%q: player[%d]=%v want %s", tc.in, i, got[i]["name"], tc.want[i])
			}
		}
	}
}
