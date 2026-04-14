import React, { useEffect, useState } from 'react';
import { Container, Box, Typography, Paper, Tabs, Tab } from '@mui/material';
import MealForm from './components/MealForm';
import MealList from './components/MealList';
import MealPlan from './components/MealPlan';
import Passcode from './components/Passcode';
import { getAllMeals } from './services/firebaseService';

const App = () => {
	const [unlocked, setUnlocked] = useState(
		sessionStorage.getItem('unlocked') === 'true'
	);
	const [meals, setMeals] = useState([]);
	const [weekMeals, setWeekMeals] = useState([]);
	const [view, setView] = useState('week');

	const fetchMeals = async () => {
		const data = await getAllMeals();
		setMeals(data);
	};

	useEffect(() => {
		if (unlocked) fetchMeals();
	}, [unlocked]);

	const handleUnlock = () => {
		sessionStorage.setItem('unlocked', 'true');
		setUnlocked(true);
	};

	if (!unlocked) {
		return <Passcode onUnlock={handleUnlock} />;
	}

	return (
		<Container maxWidth="md" style={{ marginTop: '2rem' }}>
			<Paper elevation={3}>
				<Box p={4}>
					<Typography variant="h4" align="center" gutterBottom>
						Meal Planner
					</Typography>

					<Box my={3}>
						<Tabs
							value={view}
							onChange={(_, val) => setView(val)}
							textColor="primary"
							indicatorColor="primary"
							centered
						>
							<Tab label="Weekly Plan" value="week" />
							<Tab label="Meal Library" value="library" />
						</Tabs>
					</Box>

					{view === 'week' && (
						<MealPlan
							meals={meals}
							weekMeals={weekMeals}
							setWeekMeals={setWeekMeals}
						/>
					)}

					{view === 'library' && (
						<>
							<MealForm fetchMeals={fetchMeals} />
							<MealList
								meals={meals}
								setMeals={setMeals}
								fetchMeals={fetchMeals}
							/>
						</>
					)}
				</Box>
			</Paper>
		</Container>
	);
};

export default App;
