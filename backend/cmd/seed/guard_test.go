package main

import (
	"testing"

	"mitbringsel/internal/config"
)

func TestCheckTarget(t *testing.T) {
	tests := []struct {
		name    string
		env     config.Env
		url     string
		wantErr bool
	}{
		{name: "localhost", env: config.EnvDevelopment, url: "postgres://u:p@localhost:5432/db"},
		{name: "ipv4 loopback", env: config.EnvDevelopment, url: "postgres://u:p@127.0.0.1:5432/db"},
		{name: "ipv6 loopback", env: config.EnvDevelopment, url: "postgres://u:p@[::1]:5432/db"},
		{name: "unix socket", env: config.EnvDevelopment, url: "host=/var/run/postgresql user=u dbname=db"},
		{name: "several local hosts", env: config.EnvDevelopment, url: "postgres://u:p@localhost:5432,127.0.0.1:5433/db"},

		{name: "staging", env: config.EnvStaging, url: "postgres://u:p@localhost:5432/db", wantErr: true},
		{name: "production", env: config.EnvProduction, url: "postgres://u:p@localhost:5432/db", wantErr: true},
		{name: "empty env", env: "", url: "postgres://u:p@localhost:5432/db", wantErr: true},

		{name: "remote hostname", env: config.EnvDevelopment, url: "postgres://u:p@db.example.com:5432/db", wantErr: true},
		{name: "docker service name", env: config.EnvDevelopment, url: "postgres://u:p@mitbringsel-prod-db:5432/db", wantErr: true},
		{name: "remote ip", env: config.EnvDevelopment, url: "postgres://u:p@10.0.0.5:5432/db", wantErr: true},
		{name: "remote fallback host", env: config.EnvDevelopment, url: "postgres://u:p@localhost:5432,db.example.com:5432/db", wantErr: true},
		{name: "host that only starts like localhost", env: config.EnvDevelopment, url: "postgres://u:p@localhost.example.com:5432/db", wantErr: true},

		{name: "broken url", env: config.EnvDevelopment, url: "postgres://u:p@local host:5432/db%zz", wantErr: true},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := checkTarget(tt.env, tt.url)
			if (err != nil) != tt.wantErr {
				t.Errorf("checkTarget() error = %v, wantErr %v", err, tt.wantErr)
			}
		})
	}
}
