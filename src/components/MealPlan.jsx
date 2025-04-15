import React from 'react';
import { List, ListItem, ListItemText, Button } from '@mui/material';
import RefreshIcon from '@mui/icons-material/Refresh';
import AutorenewIcon from '@mui/icons-material/Autorenew';

const MealPlan = ({ meals, weekMeals, setWeekMeals }) => {
	const handleRegenerate = (mealToReplace) => {
		const currentIds = weekMeals.map((m) => m.id);
		const availableMeals = meals.filter((m) => !currentIds.includes(m.id));

		if (availableMeals.length === 0) {
			alert('No more unique meals available to swap in!');
			return;
		}

		const newMeal =
			availableMeals[Math.floor(Math.random() * availableMeals.length)];

		setWeekMeals((prev) =>
			prev.map((m) => (m.id === mealToReplace.id ? newMeal : m))
		);
	};

	const handleGenerateWeek = () => {
		if (meals.length < 5) {
			alert('Not enough meals to generate a full week!');
			return;
		}
		const shuffled = [...meals].sort(() => 0.5 - Math.random());
		setWeekMeals(shuffled.slice(0, 5));
	};

	return (
		<div>
			<List>
				{weekMeals.map((meal) => (
					<ListItem key={meal.id} divider>
						<ListItemText
							primary={meal.name}
							secondary={`Protein: ${meal.protein} | Vegetable: ${meal.vegetable} | Carb: ${meal.carb} | Extras: ${meal.extras}`}
						/>
						<Button
							variant="contained"
							color="primary"
							startIcon={<RefreshIcon />}
							onClick={() => handleRegenerate(meal)}
						>
							Regenerate
						</Button>
					</ListItem>
				))}
			</List>
			<Button
				variant="outlined"
				startIcon={<AutorenewIcon />}
				fullWidth
				onClick={handleGenerateWeek}
			>
				Generate Week
			</Button>
		</div>
	);
};

export default MealPlan;
