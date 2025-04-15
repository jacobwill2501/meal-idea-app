const express = require('express');
const path = require('path');
const db = require('./db');

const app = express();
const PORT = 3000;

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

// API to get all meals
app.get('/api/meals', (req, res) => {
	db.all('SELECT * FROM meals ORDER BY id DESC', [], (err, rows) => {
		if (err) return res.status(500).json({ error: err.message });
		res.json(rows);
	});
});

// API to add a meal
app.post('/api/meals', (req, res) => {
	const { name, protein, vegetable, carb, extras } = req.body;

	if (!name) {
		return res.status(400).json({ error: 'Meal name is required' });
	}

	const safeProtein = protein || '';
	const safeVegetable = vegetable || '';
	const safeCarb = carb || '';
	const safeExtras = extras || '';

	db.run(
		'INSERT INTO meals (name, protein, vegetable, carb, extras) VALUES (?, ?, ?, ?, ?)',
		[name, safeProtein, safeVegetable, safeCarb, safeExtras],
		function (err) {
			if (err) return res.status(500).json({ error: err.message });

			// Log the new meal added
			console.log('Inserted meal with ID:', this.lastID);

			res.json({
				id: this.lastID,
				name,
				safeProtein,
				safeVegetable,
				safeCarb,
				safeExtras,
			});
		}
	);
});

// API to delete a meal
app.delete('/api/meals/:id', (req, res) => {
	const { id } = req.params;
	db.run('DELETE FROM meals WHERE id = ?', [id], function (err) {
		if (err) return res.status(500).json({ error: err.message });
		res.json({ success: true });
	});
});

// ✅ NEW: Update route (PUT)
app.put('/api/meals/:id', (req, res) => {
	const { id } = req.params;
	const { name, protein, vegetable, carb, extras } = req.body;

	if (!name) {
		return res.status(400).json({ error: 'Meal name is required' });
	}

	const safeProtein = protein || '';
	const safeVegetable = vegetable || '';
	const safeCarb = carb || '';
	const safeExtras = extras || '';

	db.run(
		`UPDATE meals
		 SET name = ?, protein = ?, vegetable = ?, carb = ?, extras = ?
		 WHERE id = ?`,
		[name, safeProtein, safeVegetable, safeCarb, safeExtras || '', id],
		function (err) {
			if (err) return res.status(500).json({ error: err.message });

			if (this.changes === 0) {
				return res.status(404).json({ error: 'Meal not found' });
			}

			res.json({ success: true });
		}
	);
});

// Catch-all route to serve the React app's index.html for all non-API routes
app.get(/^\/(?!api).*/, (req, res) => {
	res.sendFile(path.resolve(__dirname, 'public', 'index.html'));
});

// ✅ Start the server last
app.listen(PORT, () => {
	console.log(`Server running at http://localhost:${PORT}`);
});
