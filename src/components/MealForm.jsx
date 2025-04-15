import React, { useState } from 'react';
import { TextField, Button, Stack, Box } from '@mui/material';
import AddIcon from '@mui/icons-material/Add';

const MealForm = ({ fetchMeals }) => {
	const [newMeal, setNewMeal] = useState({
		name: '',
		protein: '',
		vegetable: '',
		carb: '',
		extras: '',
	});

	const handleAddMeal = async () => {
		if (!newMeal.name.trim()) return;

		const res = await fetch('/api/meals', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				...newMeal,
				protein: newMeal.protein.trim(),
				vegetable: newMeal.vegetable.trim(),
				carb: newMeal.carb.trim(),
				extras: newMeal.extras.trim(),
			}),
		});

		if (res.ok) {
			setNewMeal({
				name: '',
				protein: '',
				vegetable: '',
				carb: '',
				extras: '',
			});
			fetchMeals();
		} else {
			const error = await res.json();
			alert(error.error);
		}
	};

	return (
		<Stack spacing={2} mb={2}>
			<Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
				<TextField
					label="Meal Name"
					variant="outlined"
					fullWidth
					value={newMeal.name}
					onChange={(e) => setNewMeal({ ...newMeal, name: e.target.value })}
				/>
				<TextField
					label="Protein Option"
					fullWidth
					value={newMeal.protein}
					onChange={(e) => setNewMeal({ ...newMeal, protein: e.target.value })}
				/>
			</Stack>
			<Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
				<TextField
					label="Vegetable/Fiber Option"
					fullWidth
					value={newMeal.vegetable}
					onChange={(e) =>
						setNewMeal({ ...newMeal, vegetable: e.target.value })
					}
				/>
				<TextField
					label="Carb Option"
					fullWidth
					value={newMeal.carb}
					onChange={(e) => setNewMeal({ ...newMeal, carb: e.target.value })}
				/>
				<TextField
					label="Extras"
					fullWidth
					value={newMeal.extras}
					onChange={(e) => setNewMeal({ ...newMeal, extras: e.target.value })}
				/>
			</Stack>
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
