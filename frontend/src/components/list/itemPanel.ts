// From this width the item form stands as a panel next to the list instead
// of a dialog (design "markt2-desktop"). Below it there is no room for both
// side by side: sidebar (18.875rem) + list (35rem) + panel (22.5rem plus
// 2rem margin) is 78.375rem. ListView.vue repeats the number in its CSS,
// since a media query cannot read a custom property.
export const ITEM_PANEL_QUERY = '(min-width: 79rem)'
