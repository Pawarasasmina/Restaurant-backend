import test from 'node:test';import assert from 'node:assert/strict';import{transitions}from'../src/services/domain.js';
test('order lifecycle permits only explicit forward transitions',()=>{assert.deepEqual(transitions.pending,['accepted','rejected','cancelled']);assert.equal(transitions.preparing.includes('served'),false);assert.deepEqual(transitions.completed,[])});
test('cancelled and rejected orders are terminal',()=>{assert.deepEqual(transitions.cancelled,[]);assert.deepEqual(transitions.rejected,[])});

