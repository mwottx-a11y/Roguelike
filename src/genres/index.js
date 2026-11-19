// HEXBEAT — the eight genre packs, by id. One file per genre; the contract is in tools/t/packs.mjs
// (run `node tools/packcheck.mjs src/genres/<id>.js` on a draft).
import baroque from './baroque.js';
import metal from './metal.js';
import jazz from './jazz.js';
import funk from './funk.js';
import synthwave from './synthwave.js';
import celtic from './celtic.js';
import chiprock from './chiprock.js';
import latin from './latin.js';

export const GENRES = Object.freeze({ baroque, metal, jazz, funk, synthwave, celtic, chiprock, latin });
export const GENRE_IDS = Object.freeze(Object.keys(GENRES));
