const sqlite3 = require('sqlite3').verbose();
const path = require('path');

// Create or open the database file
const db = new sqlite3.Database(path.join(__dirname, './meals.db'), (err) => {
	if (err) {
		console.error('Failed to open the database:', err.message);
	} else {
		console.log('Connected to the SQLite database.');
	}
});

// Initialize the meals table if it doesn't already exist
db.serialize(() => {
	db.run(
		`
    CREATE TABLE IF NOT EXISTS meals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      protein TEXT,
      vegetable TEXT,
      carb TEXT,
      extras TEXT
    );
  `,
		(err) => {
			if (err) {
				console.error('Error creating meals table:', err.message);
			} else {
				console.log('Meals table is ready.');
			}
		}
	);
});

module.exports = db;
