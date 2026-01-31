import { Shell } from "./shell";
import { connectCommand } from "./connect";

async function main() {
  const args = process.argv.slice(2);
  const cmd = args[0];

  if (cmd === "connect") {
    await connectCommand(args.slice(1));
    return;
  }

  if (cmd === "shell" || !cmd) {
    const shell = new Shell();
    await shell.start();
    return;
  }

  if (cmd === "doctor") {
    console.log("TRCODER CLI ok.");
    return;
  }

  console.log("Unknown command. Try: trcoder shell");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
