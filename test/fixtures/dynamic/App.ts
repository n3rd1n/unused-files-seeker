const lazy = () => import('./lazy')
const legacy = require('./legacy')
const nested = { load: () => import('./deep/nested') }
foo.require('./member-only')
console.log(lazy, legacy, nested)
