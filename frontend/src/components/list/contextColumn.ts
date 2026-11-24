// From this width the list view gets the context column next to the list,
// with the item form as a card in it (design "markt2-kontext-*", ADR 0008).
// Below it the form is a dialog. ListView.vue and ListHeader.vue repeat the
// number in their CSS, since a media query cannot read a custom property.
export const CONTEXT_COLUMN_QUERY = '(min-width: 80rem)'
