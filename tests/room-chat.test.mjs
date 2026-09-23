import test from 'node:test';import assert from 'node:assert/strict';
import {isNukeCode,sanitizeChat} from '../server/room-chat.mjs';
test('room code exact and chat length bounded',()=>{
 assert.equal(isNukeCode('Maydaymayday'),true);
 assert.equal(isNukeCode('maydaymayday'),false);
 assert.equal(isNukeCode(' Maydaymayday'),false);
 assert.equal(sanitizeChat('x'.repeat(201)),null);
 assert.equal(sanitizeChat('你好'), '你好');
});
