import React, { useState, useEffect } from 'react';
import {
	ListItem,
	ListItemText,
	IconButton,
	Collapse,
	Button,
	Stack,
	Box,
	List,
	ListItem as MuiListItem,
} from '@mui/material';
import EditIcon from '@mui/icons-material/Edit';
import DeleteIcon from '@mui/icons-material/Delete';
import { updateMeal } from '../services/firebaseService';
import IngredientRowsEditor from './IngredientRowsEditor';
import { formatIngredientRows } from '../utils/formatIngredientRows';

function cleanRows(rows) {
	return rows.filter((row) => row.name && row.name.trim());
}

const MealItem = ({
	meal,
	setMeals,
	expandedMealId,
	setExpandedMealId,
	handleDeleteMeal,
}) => {
	const [editFields, setEditFields] = useState({
		protein: meal.protein || [],
		vegetable: meal.vegetable || [],
		carb: meal.carb || [],
		extras: meal.extras || [],
	});

	useEffect(() => {
		if (expandedMealId === meal.id) {
			setEditFields({
				protein: meal.protein || [],
				vegetable: meal.vegetable || [],
				carb: meal.carb || [],
				extras: meal.extras || [],
			});
		}
	}, [expandedMealId, meal]);

	const handleSaveMeal = async () => {
		const updatedMeal = {
			...meal,
			protein: cleanRows(editFields.protein),
			vegetable: cleanRows(editFields.vegetable),
			carb: cleanRows(editFields.carb),
			extras: cleanRows(editFields.extras),
		};
		await updateMeal(meal.id, updatedMeal);
		setMeals((prev) => prev.map((m) => (m.id === meal.id ? updatedMeal : m)));
		setExpandedMealId(null);
	};

	return (
		<>
			<ListItem divider alignItems="flex-start">
				<Box sx={{ flexGrow: 1 }}>
					<ListItemText
						primary={meal.name}
						secondary={`Protein: ${formatIngredientRows(meal.protein)} | Vegetable: ${formatIngredientRows(meal.vegetable)} | Carb: ${formatIngredientRows(meal.carb)} | Extras: ${formatIngredientRows(meal.extras)}`}
					/>
					<Collapse
						in={expandedMealId === meal.id}
						timeout="auto"
						unmountOnExit
					>
						<List component="div" disablePadding sx={{ pl: 2 }}>
							<MuiListItem>
								<Stack spacing={2} width="100%">
									<IngredientRowsEditor
										label="Protein Option"
										rows={editFields.protein}
										onChange={(rows) => setEditFields({ ...editFields, protein: rows })}
									/>
									<IngredientRowsEditor
										label="Vegetable/Fiber Option"
										rows={editFields.vegetable}
										onChange={(rows) => setEditFields({ ...editFields, vegetable: rows })}
									/>
									<IngredientRowsEditor
										label="Carb Option"
										rows={editFields.carb}
										onChange={(rows) => setEditFields({ ...editFields, carb: rows })}
									/>
									<IngredientRowsEditor
										label="Extras"
										rows={editFields.extras}
										onChange={(rows) => setEditFields({ ...editFields, extras: rows })}
									/>
									<Stack direction="row" spacing={2}>
										<Button
											variant="contained"
											color="primary"
											onClick={handleSaveMeal}
										>
											Save
										</Button>
										<Button
											variant="outlined"
											color="secondary"
											onClick={() => handleDeleteMeal(meal.id)}
										>
											Delete
										</Button>
									</Stack>
								</Stack>
							</MuiListItem>
						</List>
					</Collapse>
				</Box>

				<IconButton
					color="primary"
					onClick={() =>
						setExpandedMealId(expandedMealId === meal.id ? null : meal.id)
					}
				>
					<EditIcon />
				</IconButton>
			</ListItem>
		</>
	);
};

export default MealItem;
