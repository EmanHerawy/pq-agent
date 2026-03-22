import chalk from "chalk";
import qrcode from "qrcode-terminal";

function generateQR(text: string): Promise<string> {
  return new Promise((resolve) => {
    qrcode.generate(text, { small: true }, (qr: string) => {
      resolve(qr);
    });
  });
}

export async function displayAccounts(
  accounts: Array<{ label: string; address: string }>,
) {
  for (const { label, address } of accounts) {
    console.log(chalk.white.bold(`  ${label}`));
    console.log(chalk.gray(`  ${address}\n`));
    const qr = await generateQR(address);
    console.log(
      qr
        .split("\n")
        .map((line) => `    ${line}`)
        .join("\n"),
    );
    console.log("");
  }
}
