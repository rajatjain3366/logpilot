// A project logger whose library LogPilot cannot tell, used by the fix-preview fixtures
// project-existing-call.js and project-no-example.js.
module.exports = {
  error: (...args) => console.error(new Date().toISOString(), ...args),
};
