/* global console, Buffer */

import {
  createFormPdf,
  createBlankPdf,
  inspectFormFields,
} from 'C:/Users/ayomide/codebase/pdf.complianttools.com/packages/engine/dist/index.js';
import { writeFile } from 'node:fs/promises';

// Create a form with the fields from the user's description
const formPdf = await createFormPdf(createBlankPdf(), [
  { name: 'Full name', type: 'text', page: 1, x: 72, y: 700, width: 200, height: 24 },
  { name: 'Email address', type: 'text', page: 1, x: 72, y: 660, width: 200, height: 24 },
  { name: 'Phone number', type: 'text', page: 1, x: 72, y: 620, width: 200, height: 24 },
  { name: 'City', type: 'text', page: 1, x: 72, y: 580, width: 200, height: 24 },
  { name: 'Date of birth', type: 'text', page: 1, x: 72, y: 540, width: 200, height: 24 },
  { name: 'Reference number', type: 'text', page: 1, x: 72, y: 500, width: 200, height: 24 },
  {
    name: 'Preferred contact method',
    type: 'radio',
    page: 1,
    x: 72,
    y: 440,
    width: 18,
    height: 18,
    options: ['Email', 'Phone', 'SMS'],
  },
  {
    name: 'Referral source',
    type: 'dropdown',
    page: 1,
    x: 72,
    y: 380,
    width: 200,
    height: 24,
    options: ['Web', 'Friend', 'Ad', 'Other'],
  },
  { name: 'Confirmation', type: 'checkbox', page: 1, x: 72, y: 340, width: 18, height: 18 },
  { name: 'Additional comments', type: 'text', page: 1, x: 72, y: 280, width: 300, height: 60 }, // textarea-like
]);

await writeFile('C:/code/fillable_form_test.pdf', Buffer.from(formPdf));
console.log('Created test PDF');

const fields = await inspectFormFields(formPdf);
console.log(
  'Detected fields:',
  fields.map((f) => ({ name: f.name, type: f.type, value: f.value })),
);
