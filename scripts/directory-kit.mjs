// Builds the app-directory kit in directory/: square icons from src/app/icon.svg's mark, and the ChatGPT plugin ZIP.
//   node scripts/directory-kit.mjs
import { readFileSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import sharp from "sharp";

// Full-bleed dark square (directories apply their own corner mask), the white mark centred at 62%.
const mark = readFileSync("src/app/icon.svg", "utf8").match(/<svg x="[\s\S]*?<\/svg>/)[0]
  .replace(/x="9" y="9" width="30" height="30"/, 'x="9.1" y="9.1" width="29.8" height="29.8"');
const square = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48"><rect width="48" height="48" fill="#0b0b0c"/>${mark}</svg>`);

const out = async (file, size) => { await sharp(square, { density: 1200 }).resize(size, size).png().toFile(file); console.log(file); };
await out("directory/icons/heardex-1024.png", 1024);
await out("directory/icons/heardex-512.png", 512);
await out("directory/chatgpt/assets/logo.png", 512);
await out("directory/chatgpt/assets/composer-icon.png", 128);

// ZIP with plugin.json, mcp.json, skills/ and assets/ at its root.
rmSync("directory/heardex-chatgpt-plugin.zip", { force: true });
execFileSync("zip", ["-qrX", "../heardex-chatgpt-plugin.zip", "plugin.json", "mcp.json", "skills", "assets", "-x", "*.DS_Store"], { cwd: "directory/chatgpt" });
console.log("directory/heardex-chatgpt-plugin.zip");
