module.exports = {
  appId: "com.aswaqbadr.pos",
  productName: "Aswaq Badr",
  electronVersion: "45.1.0",
  directories: {
    output: "../release/windows",
    buildResources: ".",
  },
  files: ["main.cjs", "app.ico", "ui/**/*", "package.json"],
  npmRebuild: false,
  win: {
    target: [{ target: "nsis", arch: ["x64"] }],
    icon: "app.ico",
    artifactName: "AswaqBadr-Setup-${version}.${ext}",
  },
  nsis: {
    oneClick: false,
    allowToChangeInstallationDirectory: true,
    perMachine: false,
    createDesktopShortcut: true,
    createStartMenuShortcut: true,
    shortcutName: "أسواق بدر",
  },
};
