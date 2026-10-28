// Package migrations embeds the SQL migration files into the server binary,
// so the deployed image needs no separate migration files.
package migrations

import "embed"

// FS contains every *.sql file in this directory.
//
//go:embed *.sql
var FS embed.FS
