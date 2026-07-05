let booted = false;

function boot(): void {
  if (booted) return;
  booted = true;
  import('./bootstrap')
    .then(module => module.bootstrapApp())
    .catch(err => console.error(err));
}

requestAnimationFrame(() => requestAnimationFrame(() => boot()));
setTimeout(boot, 100);
