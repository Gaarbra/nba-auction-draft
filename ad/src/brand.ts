// Hoop Bids brand tokens, pulled from the app (client/src/index.css):
// dark scoreboard surfaces + a gold accent, Space Grotesk display type.
import { loadFont } from "@remotion/google-fonts/SpaceGrotesk";

const { fontFamily } = loadFont();

export const DISPLAY = fontFamily;

export const COLOR = {
  void: "#0c0d10",
  panel: "#17191d",
  panelRaised: "#1f2126",
  line: "#2a2d33",
  text: "#f2eee4",
  dim: "#8b8d93",
  accent: "#ffb020",
  accentBright: "#ffc352",
  win: "#3ecf6e",
};
