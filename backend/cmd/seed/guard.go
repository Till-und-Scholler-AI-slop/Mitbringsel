package main

import (
	"fmt"
	"strings"

	"github.com/jackc/pgx/v5/pgxpool"

	"mitbringsel/internal/config"
)

// localHosts are the database hosts that count as "this machine". A host
// that starts with "/" is the directory of a Unix socket and local as well.
var localHosts = map[string]bool{
	"localhost": true,
	"127.0.0.1": true,
	"::1":       true,
}

// checkTarget refuses to seed anything but a local development database.
// It runs before the connection is opened, because seeding replaces data:
// a DATABASE_URL copied from a staging .env must not get that far. There is
// deliberately no flag to override it.
func checkTarget(env config.Env, databaseURL string) error {
	if env != config.EnvDevelopment {
		return fmt.Errorf("refusing to seed: APP_ENV is %q, seeding only runs in %q", env, config.EnvDevelopment)
	}

	// Parsed by the same function the pool uses, so we check the hosts that
	// would really be contacted, including those from PG* variables.
	cfg, err := pgxpool.ParseConfig(databaseURL)
	if err != nil {
		return fmt.Errorf("parse DATABASE_URL: %w", err)
	}

	// pgx tries the fallbacks (from a URL with several hosts) when the first
	// host fails, so every one of them has to be local.
	hosts := []string{cfg.ConnConfig.Host}
	for _, fb := range cfg.ConnConfig.Fallbacks {
		hosts = append(hosts, fb.Host)
	}
	for _, host := range hosts {
		if !isLocalHost(host) {
			return fmt.Errorf("refusing to seed: database host %q is not local", host)
		}
	}
	return nil
}

func isLocalHost(host string) bool {
	return localHosts[host] || strings.HasPrefix(host, "/")
}
