import React, { useState } from 'react';
import {
  Box,
  Button,
  List,
} from '@mui/material';
import ShoppingCartIcon from '@mui/icons-material/ShoppingCart';
import MealItem from './MealItem';
import { deleteMeal } from '../services/firebaseService';
import { addMealItems } from '../services/groceryService';

const MealList = ({ meals, setMeals, fetchMeals, weekMeals }) => {
  const [expandedMealId, setExpandedMealId] = useState(null);

  const handleDeleteMeal = async (id) => {
    await deleteMeal(id);
    await fetchMeals();
  };

  const handleAddToGrocery = async () => {
    if (!weekMeals || weekMeals.length === 0) return;
    try {
      await addMealItems(weekMeals);
      alert('Week\'s meals added to Grocery List!');
    } catch (e) {
      console.error(e);
      alert('Failed to add meals to Grocery List.');
    }
  };

  return (
    <Box>
      <Box display="flex" justifyContent="flex-end" mb={1}>
        <Button
          variant="outlined"
          color="success"
          startIcon={<ShoppingCartIcon />}
          onClick={handleAddToGrocery}
          disabled={!weekMeals || weekMeals.length === 0}
        >
          Add Week to Grocery List
        </Button>
      </Box>
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
    </Box>
  );
};

export default MealList;
