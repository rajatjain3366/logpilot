// Fix-preview fixture for LP003: tabs, single quotes and no semicolons. The log line copies that
// style. See test/lp003-fix.test.ts.

const express = require('express')

const router = express.Router()

router.get('/items', async (req, res) => {
	try {
		res.json(await loadItems())
	} catch (err) {
		res.status(500).send('Could not load items')
	}
})

module.exports = router
