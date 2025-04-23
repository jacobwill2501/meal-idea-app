import React from 'react';
import {
	List,
	ListItem,
	ListItemText,
	Button,
	Select,
	MenuItem,
	InputLabel,
	FormControl,
} from '@mui/material';
import RefreshIcon from '@mui/icons-material/Refresh';
import AutorenewIcon from '@mui/icons-material/Autorenew';

const MealPlan = ({ meals, weekMeals, setWeekMeals }) => {
	const [numOfMeals, setNumOfMeals] = React.useState(5);
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
		if (meals.length < numOfMeals) {
			alert(
				`Not enough meals to generate ${numOfMeals}! Please change the selection below.`
			);
			return;
		}
		const shuffled = [...meals].sort(() => 0.5 - Math.random());
		setWeekMeals(shuffled.slice(0, numOfMeals));
	};

	const handleChange = (e) => {
		setNumOfMeals(e.target.value);
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
			<div
				style={{
					display: 'flex',
					alignItems: 'center',
					gap: '10px',
					justifyContent: 'center',
					gap: '32px',
				}}
			>
				<Button
					variant="outlined"
					startIcon={<AutorenewIcon />}
					onClick={handleGenerateWeek}
				>
					Generate Week
				</Button>
				<FormControl sx={{ minWidth: 120 }}>
					<InputLabel id="demo-simple-select-label"># of meals</InputLabel>
					<Select
						labelId="demo-simple-select-label"
						id="demo-simple-select"
						value={numOfMeals}
						label="# of meals"
						onChange={handleChange}
					>
						{[...Array(10).keys()].map((num) => (
							<MenuItem key={num + 1} value={num + 1}>
								{num + 1}
							</MenuItem>
						))}
					</Select>
				</FormControl>
			</div>
		</div>
	);
};

export default MealPlan;
