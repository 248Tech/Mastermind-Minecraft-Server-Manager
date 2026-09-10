-- Columns were originally added as unquoted telnet_* on server_instances; current table is "ServerInstance" with quoted snake_case columns (see 20260910000002+).
ALTER TABLE "ServerInstance" RENAME COLUMN "telnet_host" TO "rcon_host";
ALTER TABLE "ServerInstance" RENAME COLUMN "telnet_port" TO "rcon_port";
ALTER TABLE "ServerInstance" RENAME COLUMN "telnet_password" TO "rcon_password";
