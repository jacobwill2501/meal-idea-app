import React, { useState } from 'react';
import {
	List,
	ListItem,
	ListItemText,
	IconButton,
	Collapse,
	Stack,
	Button,
} from '@mui/material';
import EditIcon from '@mui/icons-material/Edit';
import DeleteIcon from '@mui/icons-material/Delete';
import MealItem from './MealItem';

const MealList = ({ meals, setMeals, fetchMeals }) => {
	const [expandedMealId, setExpandedMealId] = useState(null);

	const handleDeleteMeal = async (id) => {
		const res = await fetch(`/api/meals/${id}`, {
			method: 'DELETE',
		});
		if (res.ok) fetchMeals();
	};

	return (
		<List>
			{meals.map((meal) => (
				<MealItem
					key={meal.id}
					meal={meal}
					setMeals={setMeals}
					expandedMealId={expandedMealId}
					setExpandedMealId={setExpandedMealId}
					handleDeleteMeal={handleDeleteMeal}
				/>
			))}
		</List>
	);
};

export default MealList;
