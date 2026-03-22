import chalk from "chalk";
import figlet from "figlet";

export function showBanner() {
  const banner = figlet.textSync("scaffold-agent", { font: "Small" });
  console.log("");
  console.log(chalk.cyan(banner));
  console.log(chalk.gray("  Build onchain AI agents — fast.\n"));
}

export function section(title: string) {
  console.log("");
  console.log(chalk.cyan.bold(`━━━━ ${title} ━━━━`));
  console.log("");
}

export function success(msg: string) {
  console.log(chalk.green("  ✔ ") + msg);
}

export function info(msg: string) {
  console.log(chalk.blue("  ℹ ") + msg);
}

export function warn(msg: string) {
  console.log(chalk.yellow("  ⚠ ") + msg);
}

export function keyValue(key: string, value: string) {
  console.log(chalk.gray(`    ${key}: `) + chalk.white(value));
}
