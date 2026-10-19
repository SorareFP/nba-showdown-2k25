// Which sections sit on the phone's bottom bar, and which go behind More.
//
// A bottom bar holds five at most before the labels stop fitting a 375-pixel
// screen, so a signed-in player's seven sections split: the four used every
// session on the bar, in the order a session runs (play, adjust the team,
// check the season, open packs), and the rest in a sheet behind More. A
// guest has two sections and gets both, with no More. Since 2026-10-19 every
// game mode is under Play ('modes', the hub), so a signed-in player has five
// sections and they all fit the bar; PHONE_BAR is the order if more return.
export const PHONE_BAR = ['modes', 'builder', 'collection', 'home'];
export const PHONE_BAR_MAX = 5;

export function phoneNavTabs(tabs) {
  if (tabs.length <= PHONE_BAR_MAX) return { bar: tabs, more: [] };
  const bar = PHONE_BAR.map(id => tabs.find(t => t.id === id)).filter(Boolean);
  const more = tabs.filter(t => !bar.includes(t));
  return { bar, more };
}
