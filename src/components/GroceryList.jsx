import React, { useState, useEffect } from 'react';
import {
  Box,
  Button,
  Checkbox,
  CircularProgress,
  Divider,
  List,
  ListItem,
  ListItemText,
  Stack,
  TextField,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import DeleteSweepIcon from '@mui/icons-material/DeleteSweep';
import {
  getList,
  addMealItems,
  addStapleItems,
  addManualItem,
  toggleItem,
  clearList,
} from '../services/groceryService';
import { getAllStaples } from '../services/staplesService';

const GroceryList = ({ weekMeals }) => {
  const [list, setList] = useState({});
  const [newItem, setNewItem] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const data = await getList();
      setList(data);
      setLoading(false);
    })();
  }, []);

  const refresh = async () => {
    const data = await getList();
    setList({ ...data });
  };

  const handleAdd = async () => {
    if (!newItem.trim()) return;
    await addManualItem(newItem.trim());
    setNewItem('');
    await refresh();
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter') handleAdd();
  };

  const handleAddMealPlan = async () => {
    if (!weekMeals || weekMeals.length === 0) return;
    await addMealItems(weekMeals);
    await refresh();
  };

  const handleAddStaples = async () => {
    const staples = await getAllStaples();
    await addStapleItems(staples);
    await refresh();
  };

  const handleClear = async () => {
    await clearList();
    await refresh();
  };

  const handleToggle = async (key) => {
    await toggleItem(key);
    await refresh();
  };

  const formatLabel = (key, value) => {
    if (value.count > 1) {
      return `${value.displayText} x${value.count} (${value.meals.join(', ')})`;
    }
    return value.displayText;
  };

  if (loading) {
    return (
      <Box display="flex" justifyContent="center" alignItems="center" minHeight="400px">
        <CircularProgress />
      </Box>
    );
  }

  const entries = Object.entries(list);
  const unchecked = entries.filter(([, v]) => !v.checked);
  const checked = entries.filter(([, v]) => v.checked);

  return (
    <Box>
      <Stack direction="row" spacing={2} mb={2}>
        <TextField
          label="Add item"
          fullWidth
          value={newItem}
          onChange={(e) => setNewItem(e.target.value)}
          onKeyDown={handleKeyDown}
        />
        <Button
          variant="contained"
          color="secondary"
          startIcon={<AddIcon />}
          onClick={handleAdd}
        >
          Add
        </Button>
      </Stack>

      <Stack direction="row" spacing={2} mb={2} justifyContent="center" flexWrap="wrap">
        <Button variant="outlined" onClick={handleAddMealPlan}>
          Add from Meal Plan
        </Button>
        <Button variant="outlined" onClick={handleAddStaples}>
          Add from Staples
        </Button>
        <Button
          variant="outlined"
          color="error"
          startIcon={<DeleteSweepIcon />}
          onClick={handleClear}
        >
          Clear List
        </Button>
      </Stack>

      <List disablePadding>
        {unchecked.map(([key, value]) => (
          <ListItem key={key} disableGutters>
            <Checkbox checked={false} onChange={() => handleToggle(key)} />
            <ListItemText primary={formatLabel(key, value)} />
          </ListItem>
        ))}

        {checked.length > 0 && (
          <>
            <Divider sx={{ my: 1 }} />
            {checked.map(([key, value]) => (
              <ListItem key={key} disableGutters>
                <Checkbox checked={true} onChange={() => handleToggle(key)} />
                <ListItemText
                  primary={formatLabel(key, value)}
                  sx={{ textDecoration: 'line-through', color: 'text.disabled' }}
                />
              </ListItem>
            ))}
          </>
        )}
      </List>
    </Box>
  );
};

export default GroceryList;
