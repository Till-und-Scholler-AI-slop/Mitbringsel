package seed

import (
	"testing"
	"unicode/utf8"

	"mitbringsel/internal/group"
	"mitbringsel/internal/item"
	"mitbringsel/internal/list"
)

// TestData checks the seed data without a database, so a typo in data.go
// (a name over the limit, an unknown user) fails fast and also with -short.
func TestData(t *testing.T) {
	known := make(map[string]bool)
	for _, u := range userSpecs {
		known[u.Email] = true
	}

	units := make(map[item.Unit]bool)
	activeItems := 0
	for _, g := range groupSpecs {
		if n := utf8.RuneCountInString(g.Name); n > group.MaxNameLength {
			t.Errorf("group %q has %d characters, limit is %d", g.Name, n, group.MaxNameLength)
		}

		members := map[string]bool{g.Owner: true}
		if !known[g.Owner] {
			t.Errorf("group %q: owner %s is not a seed user", g.Name, g.Owner)
		}
		for _, m := range g.Members {
			members[m.Email] = true
			if !known[m.Email] {
				t.Errorf("group %q: member %s is not a seed user", g.Name, m.Email)
			}
			if m.Role != group.RoleMember && m.Role != group.RoleAdmin {
				t.Errorf("group %q: member %s has role %q, want member or admin", g.Name, m.Email, m.Role)
			}
		}

		for _, l := range g.Lists {
			if n := utf8.RuneCountInString(l.Name); n > list.MaxNameLength {
				t.Errorf("list %q has %d characters, limit is %d", l.Name, n, list.MaxNameLength)
			}
			for _, it := range l.Items {
				if !l.Archived {
					activeItems++
				}
				if it.Unit != "" {
					units[it.Unit] = true
				}
				if n := utf8.RuneCountInString(it.Name); n == 0 || n > item.MaxNameLength {
					t.Errorf("item %q has %d characters, limit is %d", it.Name, n, item.MaxNameLength)
				}
				if n := utf8.RuneCountInString(it.Note); n > item.MaxNoteLength {
					t.Errorf("note of %q has %d characters, limit is %d", it.Name, n, item.MaxNoteLength)
				}
				if it.Unit != "" && !it.Unit.Valid() {
					t.Errorf("item %q: unknown unit %q", it.Name, it.Unit)
				}
				if it.Quantity < 0 || it.Quantity > item.MaxQuantity {
					t.Errorf("item %q: quantity %v out of range", it.Name, it.Quantity)
				}
				if it.CheckedBy != "" && !members[it.CheckedBy] {
					t.Errorf("item %q is checked by %s, who is not in group %q", it.Name, it.CheckedBy, g.Name)
				}
			}
		}
	}

	if activeItems != wantActiveItems {
		t.Errorf("%d items on active lists, want %d", activeItems, wantActiveItems)
	}
	for _, u := range []item.Unit{item.UnitPiece, item.UnitGram, item.UnitKilogram, item.UnitMilliliter, item.UnitLiter, item.UnitPack} {
		if !units[u] {
			t.Errorf("no item uses the unit %q", u)
		}
	}
}
