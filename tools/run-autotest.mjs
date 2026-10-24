// Node 命令列：node tools/run-autotest.mjs [runs] [mode] [seed]
import { CONFIG, FX } from '../js/config.js';
import { Kind, KIND_LABEL } from '../js/kinds.js';
import { GAME_MODES, riseSpeedFor } from '../js/modes.js';
import { STAGES, StageManager } from '../js/stages.js';
import { PlatformGenerator } from '../js/platforms.js';
import { World, stepWorld } from '../js/world.js';
import { createPlatform } from '../js/platform-types.js';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

globalThis.__kd = { CONFIG, FX, Kind, KIND_LABEL, GAME_MODES, STAGES, StageManager, PlatformGenerator, World, stepWorld, riseSpeedFor, createPlatform };
globalThis.__AUTOTEST_NO_AUTORUN = true;
const src = readFileSync(fileURLToPath(new URL('../autoTest.js', import.meta.url)), 'utf8');
vm.runInThisContext(src);
const [runs = '5', mode = 'standard', seed = '1'] = process.argv.slice(2);
const stress = process.env.STRESS === '1';
const oracle = process.env.ORACLE !== '0';
const r = await globalThis.runAutoTest({ runs: +runs, mode, seed: +seed, stress, oracle, quiet: process.env.QUIET === '1', ...(process.env.MAXFLOOR ? { maxFloor: +process.env.MAXFLOOR } : {}) });
if (process.env.OUT) (await import('node:fs')).writeFileSync(process.env.OUT, JSON.stringify(r.aggs));
