package seed

import (
	"mitbringsel/internal/group"
	"mitbringsel/internal/item"
	"mitbringsel/internal/list"
)

// The seed data is mixed German and English on purpose, with umlauts, long
// names and a few limits pushed to the edge, so layout and encoding problems
// show up early (docs/testing.md).

// Emails of the seed users. Group and item specs refer to users by email.
const (
	emailAnna  = "anna@example.com"
	emailBen   = "ben@example.com"
	emailChloe = "chloe@example.com"
)

type userSpec struct {
	Email string
	Name  string
}

// memberSpec is a member who joins through an invite link. Role is
// group.RoleMember or group.RoleAdmin; the owner is the group's Owner.
type memberSpec struct {
	Email string
	Role  group.Role
}

// itemSpec describes one item. The zero value of Quantity, Unit and Note
// means "not set", which is why Quantity 0 never occurs: the service
// requires a quantity above 0.
type itemSpec struct {
	Name     string
	Quantity float64
	Unit     item.Unit
	Note     string
	// CheckedBy is the email of the member who checks the item off, empty
	// for an open item.
	CheckedBy string
}

type listSpec struct {
	Name string
	// Icon is empty for the default, so the seed covers that path, too.
	Icon     list.Icon
	Archived bool
	Items    []itemSpec
}

type groupSpec struct {
	Name    string
	Owner   string
	Members []memberSpec
	Lists   []listSpec
}

var userSpecs = []userSpec{
	{Email: emailAnna, Name: "Anna Schäfer"},
	{Email: emailBen, Name: "Benedikt „Ben“ Müller-Lüdenscheidt"},
	{Email: emailChloe, Name: "Chloé O'Brien"},
}

var groupSpecs = []groupSpec{
	{
		Name:  "WG Kaiserstraße 12",
		Owner: emailAnna,
		Members: []memberSpec{
			{Email: emailBen, Role: group.RoleMember},
		},
		Lists: []listSpec{
			{Name: "Supermarkt", Icon: list.IconSupermarket, Items: supermarktItems},
			{Name: "Drogerie & Haushalt", Icon: list.IconDrugstore, Items: drogerieItems},
			{Name: "Grillparty Sommer", Icon: list.IconButcher, Archived: true, Items: grillpartyItems},
		},
	},
	{
		Name:  "Familie Müller-Lüdenscheidt",
		Owner: emailBen,
		Members: []memberSpec{
			{Email: emailChloe, Role: group.RoleAdmin},
			{Email: emailAnna, Role: group.RoleMember},
		},
		Lists: []listSpec{
			{Name: "Wocheneinkauf", Items: wocheneinkaufItems},
			{Name: "Baumarkt / hardware store fürs Gartenhaus", Icon: list.IconHardware, Items: baumarktItems},
		},
	},
}

// 14 items.
var supermarktItems = []itemSpec{
	{Name: "Hafermilch", Quantity: 2, Unit: item.UnitLiter, Note: "ohne Zucker", CheckedBy: emailBen},
	{Name: "Vollkornbrot", Quantity: 1, Unit: item.UnitPiece, Note: "geschnitten"},
	{Name: "Bio-Äpfel", Quantity: 1.5, Unit: item.UnitKilogram, Note: "Boskoop, wenn es sie gibt", CheckedBy: emailAnna},
	{Name: "Spaghetti", Quantity: 500, Unit: item.UnitGram},
	{Name: "Passierte Tomaten", Quantity: 2, Unit: item.UnitPack},
	{Name: "Eier", Quantity: 10, Unit: item.UnitPiece, Note: "Freiland, Größe M"},
	{Name: "Butter", Quantity: 250, Unit: item.UnitGram, CheckedBy: emailBen},
	{Name: "Olivenöl", Note: "extra vergine, das aus dem Angebot"},
	{Name: "Gouda, mittelalt", Quantity: 0.5, Unit: item.UnitKilogram},
	{Name: "Joghurt", Quantity: 6, Unit: item.UnitPiece},
	{Name: "Gummibärchen"},
	{Name: "Basilikum", Quantity: 1, Unit: item.UnitPack, Note: "im Topf, nicht geschnitten"},
	{Name: "Mineralwasser still", Quantity: 6, Unit: item.UnitPiece, Note: "Kasten nur, wenn das Auto da ist"},
	// 97 characters: close to item.MaxNameLength, with ß, umlauts and an emoji.
	{Name: "Äußerst gründlich gewaschene Süßkartoffeln, bitte nur die kleinen, süßen Bio-Sorten aus Spanien 🍠", Quantity: 1, Unit: item.UnitKilogram},
}

// 8 items.
var drogerieItems = []itemSpec{
	{Name: "Spülmittel", Quantity: 500, Unit: item.UnitMilliliter, CheckedBy: emailBen},
	{Name: "Toilettenpapier", Quantity: 2, Unit: item.UnitPack, Note: "4-lagig"},
	{Name: "Zahnpasta", Quantity: 1, Unit: item.UnitPiece, Note: "mit Fluorid"},
	{Name: "Müllbeutel 35 l", Quantity: 1, Unit: item.UnitPack, CheckedBy: emailAnna},
	{Name: "Waschmittel"},
	{Name: "Glühbirnen E27", Quantity: 3},
	{Name: "Schwämme", Quantity: 4, Unit: item.UnitPiece},
	{Name: "Handseife, Nachfüllbeutel", Quantity: 0.5, Unit: item.UnitLiter, Note: "Lavendel, nicht Zitrone"},
}

// 12 items.
var wocheneinkaufItems = []itemSpec{
	{Name: "Vollmilch", Quantity: 3, Unit: item.UnitLiter, CheckedBy: emailChloe},
	{Name: "Bananen", Quantity: 1, Unit: item.UnitKilogram, Note: "noch ein bisschen grün"},
	{Name: "Kartoffeln, festkochend", Quantity: 2.5, Unit: item.UnitKilogram},
	{Name: "Hähnchenbrust", Quantity: 600, Unit: item.UnitGram, CheckedBy: emailAnna},
	{Name: "Pasta sauce (basil or arrabbiata)", Quantity: 2, Unit: item.UnitPiece},
	{Name: "Karotten", Quantity: 1, Unit: item.UnitKilogram},
	{Name: "Sahne", Quantity: 0.5, Unit: item.UnitLiter, CheckedBy: emailBen},
	{Name: "Frühstücksflocken"},
	{Name: "Zitronen", Quantity: 3},
	{Name: "Orangensaft", Quantity: 1, Unit: item.UnitLiter, Note: "Direktsaft, ohne Fruchtfleisch"},
	// 307 characters: a note close to what people paste in, below item.MaxNoteLength.
	{
		Name:     "Hokkaido-Kürbis (klein)",
		Quantity: 2,
		Unit:     item.UnitPiece,
		Note: "Bitte vorher fragen, ob es die Sorte auch lose gibt: Letztes Mal war nur die große Packung da, " +
			"und die ist viel zu groß für uns. Wenn nicht, lieber die kleine Variante nehmen, auch wenn sie pro " +
			"Kilo teurer ist. Falls gar nichts passt, einfach weglassen – we can order it online next week " +
			"instead, no stress!",
	},
	{Name: "Brötchen", Quantity: 8, Unit: item.UnitPiece, CheckedBy: emailChloe},
}

// 6 items.
var baumarktItems = []itemSpec{
	{Name: "Schrauben 4 × 40 mm", Quantity: 1, Unit: item.UnitPack, Note: "Edelstahl, Torx", CheckedBy: emailAnna},
	{Name: "Wetterschutzfarbe, anthrazit", Quantity: 2.5, Unit: item.UnitLiter},
	{Name: "Pinsel", Quantity: 2, Unit: item.UnitPiece, Note: "breit und schmal"},
	{Name: "Dachpappe"},
	{Name: "Dübel 8 mm", Quantity: 20, Unit: item.UnitPiece},
	{Name: "Extension cord, 10 m", Quantity: 1, Unit: item.UnitPiece, Note: "für draußen, IP44"},
}

// 4 items, on the archived list.
var grillpartyItems = []itemSpec{
	{Name: "Grillkohle", Quantity: 5, Unit: item.UnitKilogram, CheckedBy: emailBen},
	{Name: "Bratwürste", Quantity: 20, Unit: item.UnitPiece, CheckedBy: emailAnna},
	{Name: "Halloumi", Quantity: 400, Unit: item.UnitGram, CheckedBy: emailAnna},
	{Name: "Eis am Stiel", Note: "Hauptsache nicht Vanille"},
}
