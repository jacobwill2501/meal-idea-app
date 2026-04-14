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
import { deleteMeal } from '../services/mealStorage';

const MealList = ({ meals, setMeals, fetchMeals }) => {
	const [expandedMealId, setExpandedMealId] = useState(null);

	const handleDeleteMeal = (id) => {
		deleteMeal(id);
		fetchMeals();
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
