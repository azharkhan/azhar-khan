/** @type {import("shiki").ThemeRegistrationRaw} */
export const paper = {
  name: "paper",
  type: "light",
  colors: {
    "editor.background": "var(--wash)",
    "editor.foreground": "var(--ink)",
  },
  settings: [
    { scope: ["keyword", "storage"], settings: { foreground: "var(--code-k)" } },
    { scope: ["string"], settings: { foreground: "var(--code-s)" } },
    { scope: ["constant.numeric"], settings: { foreground: "var(--code-n)" } },
    { scope: ["comment"], settings: { foreground: "var(--code-c)", fontStyle: "italic" } },
  ],
};
