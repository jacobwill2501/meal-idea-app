import React, { useState, useEffect } from 'react';
import {
	ListItem,
	ListItemText,
	IconButton,
	Collapse,
	TextField,
	Button,
	Stack,
	Box,
	List,
	ListItem as MuiListItem,
} from '@mui/material';
import EditIcon from '@mui/icons-material/Edit';
import DeleteIcon from '@mui/icons-material/Delete';

const MealItem = ({
	meal,
	setMeals,
	expandedMealId,
	setExpandedMealId,
	handleDeleteMeal,
}) => {
	const [editingMeal, setEditingMeal] = useState(false);
	const [editFields, setEditFields] = useState({
		protein: meal.protein || '',
		vegetable: meal.vegetable || '',
		carb: meal.carb || '',
		extras: meal.extras || '',
	});

	useEffect(() => {
		if (expandedMealId === meal.id) {
			setEditFields({
				protein: meal.protein || '',
				vegetable: meal.vegetable || '',
				carb: meal.carb || '',
				extras: meal.extras || '',
			});
		}
	}, [expandedMealId, meal]);

	const handleSaveMeal = async () => {
		const updatedMeal = {
			...meal,
			...editFields,
		};

		const res = await fetch(`/api/meals/${meal.id}`, {
			method: 'PUT',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(updatedMeal),
		});

		if (res.ok) {
			setMeals((prev) => prev.map((m) => (m.id === meal.id ? updatedMeal : m)));
			setEditingMeal(false);
			setExpandedMealId(null);
		} else {
			const error = await res.json();
			alert(error.error);
		}
	};

	return (
		<>
			<ListItem key={meal.id} divider alignItems="flex-start">
				<Box sx={{ flexGrow: 1 }}>
					<ListItemText
						primary={meal.name}
						secondary={`Protein: ${meal.protein} | Vegetable: ${meal.vegetable} | Carb: ${meal.carb} | Extras: ${meal.extras}`}
					/>
					<Collapse
						in={expandedMealId === meal.id}
						timeout="auto"
						unmountOnExit
					>
						<List component="div" disablePadding sx={{ pl: 2 }}>
							<MuiListItem>
								<Stack spacing={2} width="100%">
									<TextField
										label="Edit Protein"
										fullWidth
										value={editFields.protein}
										onChange={(e) =>
											setEditFields({ ...editFields, protein: e.target.value })
										}
									/>
									<TextField
										label="Edit Vegetable/Fiber"
										fullWidth
										value={editFields.vegetable}
										onChange={(e) =>
											setEditFields({
												...editFields,
												vegetable: e.target.value,
											})
										}
									/>
									<TextField
										label="Edit Carb"
										fullWidth
										value={editFields.carb}
										onChange={(e) =>
											setEditFields({ ...editFields, carb: e.target.value })
										}
									/>
									<TextField
										label="Edit Extras"
										fullWidth
										value={editFields.extras}
										onChange={(e) =>
											setEditFields({ ...editFields, extras: e.target.value })
										}
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
