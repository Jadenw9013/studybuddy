// Account discovery is free; --configure and --smoke are explicit operator actions.
// Provider probes leave the real device/human lesson gates open.
await import('./provider-readiness.mjs');
// The acceptance command fails until the real browser/human gates have evidence.
process.exitCode = 2;
