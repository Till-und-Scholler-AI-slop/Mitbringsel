package item

import (
	"errors"
	"maps"
	"testing"
	"time"
)

func TestMerge(t *testing.T) {
	// Clocks relative to at: earlier, now and later; two devices.
	older := mustHLC(t, at.Add(-time.Minute), 0, "anna")
	same := mustHLC(t, at, 0, "anna")
	newer := mustHLC(t, at.Add(time.Minute), 0, "ben")

	tests := []struct {
		name     string
		current  Clocks
		incoming Clocks
		deleted  bool
		want     Clocks
	}{
		{
			name:     "different fields both win",
			current:  Clocks{FieldChecked: same},
			incoming: Clocks{FieldQuantity: older},
			// Ben changes the quantity while Anna's check mark is newer: no
			// conflict, both stay.
			want: Clocks{FieldQuantity: older},
		},
		{
			name:     "newer change to the same field wins",
			current:  Clocks{FieldName: same},
			incoming: Clocks{FieldName: newer},
			want:     Clocks{FieldName: newer},
		},
		{
			name:     "older change to the same field loses",
			current:  Clocks{FieldName: same},
			incoming: Clocks{FieldName: older},
			want:     Clocks{},
		},
		{
			name:     "equal clock loses, so a repeated change does nothing",
			current:  Clocks{FieldName: same},
			incoming: Clocks{FieldName: same},
			want:     Clocks{},
		},
		{
			name:     "field without a clock accepts any change",
			current:  Clocks{},
			incoming: Clocks{FieldNote: older},
			want:     Clocks{FieldNote: older},
		},
		{
			name:     "nil current clocks",
			current:  nil,
			incoming: Clocks{FieldNote: older},
			want:     Clocks{FieldNote: older},
		},
		{
			name:     "per field: one field wins, the other loses",
			current:  Clocks{FieldName: same, FieldNote: same},
			incoming: Clocks{FieldName: newer, FieldNote: older},
			want:     Clocks{FieldName: newer},
		},
		{
			name:     "all six fields can win at once",
			current:  Clocks{},
			incoming: Clocks{FieldName: same, FieldQuantity: same, FieldUnit: same, FieldNote: same, FieldChecked: same, FieldList: same},
			want:     Clocks{FieldName: same, FieldQuantity: same, FieldUnit: same, FieldNote: same, FieldChecked: same, FieldList: same},
		},
		{
			name:     "a move wins for an item without a listId clock",
			current:  Clocks{FieldName: newer},
			incoming: Clocks{FieldList: older},
			want:     Clocks{FieldList: older},
		},
		{
			name:     "a newer move wins, a rename with an older clock loses",
			current:  Clocks{FieldName: newer, FieldList: older},
			incoming: Clocks{FieldName: same, FieldList: newer},
			want:     Clocks{FieldList: newer},
		},
		{
			name:     "a newer rename wins, an older move loses",
			current:  Clocks{FieldName: older, FieldList: same},
			incoming: Clocks{FieldName: newer, FieldList: older},
			want:     Clocks{FieldName: newer},
		},
		{
			name:     "an equal listId clock does not win, so a repeated move does nothing",
			current:  Clocks{FieldList: same},
			incoming: Clocks{FieldList: same},
			want:     Clocks{},
		},
		{
			name:     "a deleted item accepts no move",
			current:  Clocks{FieldList: older},
			incoming: Clocks{FieldList: newer},
			deleted:  true,
			want:     Clocks{},
		},
		{
			name:     "no incoming fields",
			current:  Clocks{FieldName: same},
			incoming: Clocks{},
			want:     Clocks{},
		},
		{
			name:     "a deleted item accepts nothing, however new the change",
			current:  Clocks{FieldName: older},
			incoming: Clocks{FieldName: newer, FieldNote: newer},
			deleted:  true,
			want:     Clocks{},
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			currentBefore := maps.Clone(tt.current)

			got, err := Merge(tt.current, tt.incoming, tt.deleted, at)

			if err != nil {
				t.Fatalf("Merge() error = %v", err)
			}
			if got == nil || !maps.Equal(got, tt.want) {
				t.Errorf("Merge() = %v, want %v", got, tt.want)
			}
			if !maps.Equal(tt.current, currentBefore) {
				t.Errorf("Merge() changed its input: %v, was %v", tt.current, currentBefore)
			}
		})
	}
}

func TestMerge_sameTimeDecidedByCounterThenNode(t *testing.T) {
	low := mustHLC(t, at, 1, "zoe")
	highCounter := mustHLC(t, at, 2, "anna")
	highNode := mustHLC(t, at, 2, "ben")

	tests := []struct {
		name            string
		current, change HLC
		wins            bool
	}{
		{"higher counter beats a higher node", low, highCounter, true},
		{"lower counter loses", highCounter, low, false},
		{"same counter: the greater node wins", highCounter, highNode, true},
		{"same counter: the smaller node loses", highNode, highCounter, false},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := Merge(Clocks{FieldName: tt.current}, Clocks{FieldName: tt.change}, false, at)

			if err != nil {
				t.Fatalf("Merge() error = %v", err)
			}
			if _, won := got[FieldName]; won != tt.wins {
				t.Errorf("won = %t, want %t", won, tt.wins)
			}
		})
	}
}

// Two devices that exchange their changes in a different order must end up
// with the same state: that is what makes the merge safe for a sync.
func TestMerge_orderDoesNotMatter(t *testing.T) {
	a := mustHLC(t, at, 0, "anna")
	b := mustHLC(t, at, 0, "ben") // same time: the node decides
	c := mustHLC(t, at.Add(time.Second), 0, "cleo")

	apply := func(changes ...HLC) HLC {
		var stored Clocks
		for _, h := range changes {
			won, err := Merge(stored, Clocks{FieldName: h}, false, at.Add(time.Hour))
			if err != nil {
				t.Fatalf("Merge() error = %v", err)
			}
			if stored == nil {
				stored = Clocks{}
			}
			maps.Copy(stored, won)
		}
		return stored[FieldName]
	}

	orders := [][]HLC{{a, b, c}, {c, b, a}, {b, a, c}, {a, c, b}, {c, a, b}, {b, c, a}}
	for _, order := range orders {
		if got := apply(order...); got != c {
			t.Errorf("order %v ended with %q, want %q", order, got, c)
		}
	}
	if got := apply(a, b); got != b {
		t.Errorf("a then b ended with %q, want the greater node %q", got, b)
	}
	if got := apply(b, a); got != b {
		t.Errorf("b then a ended with %q, want the greater node %q", got, b)
	}
}

func TestMerge_clockInTheFuture(t *testing.T) {
	limit := at.Add(MaxClockSkew)

	t.Run("exactly at the limit is kept", func(t *testing.T) {
		clock := mustHLC(t, limit, 3, "anna")
		got, err := Merge(nil, Clocks{FieldName: clock}, false, at)
		if err != nil || got[FieldName] != clock {
			t.Errorf("Merge() = %v, %v, want the clock kept", got, err)
		}
	})

	t.Run("a millisecond over the limit is set to now", func(t *testing.T) {
		clock := mustHLC(t, limit.Add(time.Millisecond), 3, "anna")
		got, err := Merge(nil, Clocks{FieldName: clock}, false, at)
		if err != nil {
			t.Fatalf("Merge() error = %v", err)
		}
		want := mustHLC(t, at, 3, "anna") // time of the server, counter and node of the sender
		if got[FieldName] != want {
			t.Errorf("Merge() = %q, want %q", got[FieldName], want)
		}
	})

	t.Run("a year ahead does not win every later conflict", func(t *testing.T) {
		wrongClock := mustHLC(t, at.AddDate(1, 0, 0), 0, "anna")
		first, err := Merge(nil, Clocks{FieldName: wrongClock}, false, at)
		if err != nil {
			t.Fatalf("Merge() error = %v", err)
		}
		// An honest change a minute later must win against the stored one.
		honest := mustHLC(t, at.Add(time.Minute), 0, "ben")
		second, err := Merge(first, Clocks{FieldName: honest}, false, at.Add(time.Minute))
		if err != nil {
			t.Fatalf("Merge() error = %v", err)
		}
		if second[FieldName] != honest {
			t.Errorf("honest change lost against %q", first[FieldName])
		}
	})

	t.Run("the replaced clock can still lose", func(t *testing.T) {
		stored := Clocks{FieldName: mustHLC(t, at.Add(time.Minute), 0, "ben")}
		wrongClock := mustHLC(t, at.AddDate(1, 0, 0), 0, "anna")
		got, err := Merge(stored, Clocks{FieldName: wrongClock}, false, at)
		if err != nil || len(got) != 0 {
			t.Errorf("Merge() = %v, %v, want nothing to win: the stored change is newer than now", got, err)
		}
	})
}

func TestMerge_invalidInput(t *testing.T) {
	good := mustHLC(t, at, 0, "anna")

	tests := []struct {
		name     string
		incoming Clocks
		deleted  bool
		wantErr  error
	}{
		{"unknown field", Clocks{"price": good}, false, ErrUnknownField},
		{"empty field name", Clocks{"": good}, false, ErrUnknownField},
		{"invalid clock", Clocks{FieldName: "nonsense"}, false, ErrInvalidHLC},
		{"empty clock", Clocks{FieldName: ""}, false, ErrInvalidHLC},
		{"one bad field spoils the whole change", Clocks{FieldName: good, FieldNote: "nonsense"}, false, ErrInvalidHLC},
		{"invalid input is refused for a deleted item, too", Clocks{FieldName: "nonsense"}, true, ErrInvalidHLC},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := Merge(Clocks{}, tt.incoming, tt.deleted, at)

			if !errors.Is(err, tt.wantErr) {
				t.Errorf("error = %v, want %v", err, tt.wantErr)
			}
			if got != nil {
				t.Errorf("result = %v, want nil with an error", got)
			}
		})
	}
}

func TestField_Valid(t *testing.T) {
	for _, f := range []Field{FieldName, FieldQuantity, FieldUnit, FieldNote, FieldChecked, FieldList} {
		if !f.Valid() {
			t.Errorf("%q is not valid, want valid", f)
		}
	}
	for _, f := range []Field{"", "Name", "checked_by", "deleted", "id"} {
		if f.Valid() {
			t.Errorf("%q is valid, want invalid", f)
		}
	}
}
