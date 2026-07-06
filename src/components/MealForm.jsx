import React, { useState } from 'react';
import { TextField, Button, Stack, Box } from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import { addMeal } from '../services/firebaseService';
import IngredientRowsEditor from './IngredientRowsEditor';

const EMPTY_MEAL = {
	name: '',
	protein: [],
	vegetable: [],
	carb: [],
	extras: [],
};

function cleanRows(rows) {
	return rows.filter((row) => row.name && row.name.trim());
}

const MealForm = ({ fetchMeals }) => {
	const [newMeal, setNewMeal] = useState(EMPTY_MEAL);

	const handleAddMeal = async () => {
		if (!newMeal.name.trim()) return;

		await addMeal({
			...newMeal,
			protein: cleanRows(newMeal.protein),
			vegetable: cleanRows(newMeal.vegetable),
			carb: cleanRows(newMeal.carb),
			extras: cleanRows(newMeal.extras),
		});

		setNewMeal(EMPTY_MEAL);
		await fetchMeals();
	};

	return (
		<Stack spacing={2} mb={2}>
			<TextField
				label="Meal Name*"
				variant="outlined"
				fullWidth
				value={newMeal.name}
				onChange={(e) => setNewMeal({ ...newMeal, name: e.target.value })}
			/>
			<IngredientRowsEditor
				label="Protein Option"
				rows={newMeal.protein}
				onChange={(rows) => setNewMeal({ ...newMeal, protein: rows })}
			/>
			<IngredientRowsEditor
				label="Vegetable/Fiber Option"
				rows={newMeal.vegetable}
				onChange={(rows) => setNewMeal({ ...newMeal, vegetable: rows })}
			/>
			<IngredientRowsEditor
				label="Carb Option"
				rows={newMeal.carb}
				onChange={(rows) => setNewMeal({ ...newMeal, carb: rows })}
			/>
			<IngredientRowsEditor
				label="Extras"
				rows={newMeal.extras}
				onChange={(rows) => setNewMeal({ ...newMeal, extras: rows })}
			/>
			<Box textAlign="right">
				<Button
					variant="contained"
					color="secondary"
					startIcon={<AddIcon />}
					onClick={handleAddMeal}
				>
					Add
				</Button>
			</Box>
		</Stack>
	);
};

export default MealForm;
