import React, { useState } from 'react';
import { Box, Typography, Button, Paper } from '@mui/material';

const CORRECT_CODE = '1422';
const MAX_ATTEMPTS = 2;

const Passcode = ({ onUnlock }) => {
	const [input, setInput] = useState('');
	const [attempts, setAttempts] = useState(
		parseInt(sessionStorage.getItem('failedAttempts') || '0', 10)
	);
	const [shake, setShake] = useState(false);

	const locked = attempts >= MAX_ATTEMPTS;

	const handleKey = (digit) => {
		if (locked || input.length >= 4) return;
		const next = input + digit;
		setInput(next);
		if (next.length === 4) {
			if (next === CORRECT_CODE) {
				onUnlock();
			} else {
				const newAttempts = attempts + 1;
				sessionStorage.setItem('failedAttempts', String(newAttempts));
				setAttempts(newAttempts);
				setShake(true);
				setTimeout(() => {
					setInput('');
					setShake(false);
				}, 600);
			}
		}
	};

	const handleDelete = () => {
		setInput((prev) => prev.slice(0, -1));
	};

	const dots = Array.from({ length: 4 }, (_, i) => i < input.length);

	return (
		<Box
			display="flex"
			justifyContent="center"
			alignItems="center"
			minHeight="100vh"
			bgcolor="#f5f5f5"
		>
			<Paper elevation={4} sx={{ p: 4, width: 280, textAlign: 'center' }}>
				<Typography variant="h5" gutterBottom>
					Meal Planner
				</Typography>

				{locked ? (
					<Typography color="error" mt={2}>
						Too many failed attempts. Close and reopen the tab to try again.
					</Typography>
				) : (
					<>
						<Box
							display="flex"
							justifyContent="center"
							gap={2}
							my={3}
							sx={{
								'@keyframes shake': {
									'0%, 100%': { transform: 'translateX(0)' },
									'20%, 60%': { transform: 'translateX(-8px)' },
									'40%, 80%': { transform: 'translateX(8px)' },
								},
								animation: shake ? 'shake 0.5s' : 'none',
							}}
						>
							{dots.map((filled, i) => (
								<Box
									key={i}
									sx={{
										width: 16,
										height: 16,
										borderRadius: '50%',
										bgcolor: filled ? 'primary.main' : 'grey.400',
										transition: 'background-color 0.1s',
									}}
								/>
							))}
						</Box>

						<Box display="grid" gridTemplateColumns="repeat(3, 1fr)" gap={1}>
							{[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => (
								<Button key={n} variant="outlined" onClick={() => handleKey(String(n))}>
									{n}
								</Button>
							))}
							<Button variant="outlined" color="error" onClick={handleDelete}>
								⌫
							</Button>
							<Button variant="outlined" onClick={() => handleKey('0')}>
								0
							</Button>
							<Box />
						</Box>
					</>
				)}
			</Paper>
		</Box>
	);
};

export default Passcode;
