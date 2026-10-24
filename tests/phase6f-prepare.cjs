// This generates the exact runtime policy BEFORE firebase-tools loads/compiles the rules.
const fs=require('node:fs'),assert=require('node:assert/strict'),P=require('../js/firestore-rules-policy.js');
if(process.env.GCLOUD_PROJECT!=='demo-work-manager')throw Error('Only the demo project is allowed');
const rules=P.generate({uid:'synthetic-owner',extraUids:['synthetic-collaborator'],projectId:'demo-work-manager'});
assert.equal(fs.readFileSync('tests/emulator/firestore.rules','utf8'),rules,'Committed rule artifact drifted from runtime generator');
fs.writeFileSync('tests/emulator/firestore.rules',rules);
console.log('Generated validated runtime policy for demo-only Emulator compilation.');
