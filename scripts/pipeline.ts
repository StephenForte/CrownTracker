import "dotenv/config";

const tier = process.argv.find((argument) => argument.startsWith("--tier="))?.split("=")[1] ?? "daily";

console.log(JSON.stringify({ event: "pipeline_started", tier, at: new Date().toISOString() }));
console.log(JSON.stringify({ event: "pipeline_phase_zero", message: "No research work is scheduled yet; exiting cleanly." }));
console.log(JSON.stringify({ event: "pipeline_finished", tier, status: "succeeded", at: new Date().toISOString() }));
