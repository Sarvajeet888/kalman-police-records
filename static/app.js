'use strict';
document.addEventListener('click', event => {
  const open = event.target.closest('[data-open]');
  if (open) document.getElementById(open.dataset.open).showModal();
  if (event.target.closest('[data-close]')) event.target.closest('dialog').close();
  if (event.target.closest('[data-print]')) window.print();
  if (event.target.closest('[data-back]')) window.history.back();
});
document.querySelectorAll('input[type=file]').forEach(input => {
  input.addEventListener('change', () => {
    const file = input.files[0];
    input.setCustomValidity(file && file.size > 10 * 1024 * 1024 ? 'Choose a file no larger than 10 MB.' : file && file.size === 0 ? 'This file is empty.' : '');
    input.reportValidity();
  });
});
document.querySelectorAll('form[method=post]').forEach(form => {
  form.addEventListener('submit', () => {
    const button = form.querySelector('button:not([type=button])');
    if (button) { button.disabled = true; button.textContent = 'Please wait…'; }
  });
});
window.addEventListener('pageshow', event => { if(event.persisted) location.reload(); });
