import React, { useState, useEffect, useMemo } from 'react';
import {
  Box,
  Button,
  Checkbox,
  CircularProgress,
  Divider,
  FormControlLabel,
  IconButton,
  List,
  ListItem,
  ListItemText,
  Stack,
  Switch,
  TextField,
  Typography,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import RemoveIcon from '@mui/icons-material/Remove';
import DeleteSweepIcon from '@mui/icons-material/DeleteSweep';
import {
  getList,
  addMealItems,
  addStapleItems,
  addManualItem,
  toggleItem,
  updateQuantity,
  clearList,
} from '../services/groceryService';
import { getAllStaples } from '../services/staplesService';

const GroceryList = ({ weekMeals }) => {
  const [list, setList] = useState({});
  const [newItem, setNewItem] = useState('');
  const [loading, setLoading] = useState(true);
  const [exportAll, setExportAll] = useState(false);

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
    if (e.key === 'Enter') handleAdd().catch(console.error);
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

  const handleQuantityChange = async (key, newCount) => {
    if (newCount < 1) return;
    await updateQuantity(key, newCount);
    await refresh();
  };

  const formatLabel = (key, value) => {
    if (value.meals.length > 0) {
      return `${value.displayText} (${value.meals.join(', ')})`;
    }
    return value.displayText;
  };

  const entries = Object.entries(list);
  const unchecked = entries.filter(([, v]) => !v.checked);
  const checked = entries.filter(([, v]) => v.checked);

  const exportPayload = useMemo(() => {
    const source = exportAll ? entries : unchecked;
    return {
      exportedAt: new Date().toISOString(),
      items: source.map(([, value]) => ({
        name: value.displayText,
        quantity: value.count,
      })),
    };
  }, [list, exportAll]);

  const exportJson = JSON.stringify(exportPayload).replace(/</g, '\\u003c');

  const exportDataScript = (
    <script
      type="application/json"
      id="grocery-export-data"
      dangerouslySetInnerHTML={{ __html: exportJson }}
    />
  );

  if (loading) {
    return (
      <>
        {exportDataScript}
        <Box display="flex" justifyContent="center" alignItems="center" minHeight="400px">
          <CircularProgress />
        </Box>
      </>
    );
  }

  return (
    <Box>
      {exportDataScript}
      <FormControlLabel
        control={
          <Switch
            checked={exportAll}
            onChange={(e) => setExportAll(e.target.checked)}
          />
        }
        label={exportAll ? 'Exporting all items' : 'Exporting unchecked items only'}
        sx={{ mb: 1 }}
      />
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
          <ListItem
            key={key}
            disableGutters
            secondaryAction={
              <Stack direction="row" spacing={1} alignItems="center">
                <IconButton
                  size="small"
                  aria-label={`decrease quantity of ${value.displayText}`}
                  disabled={value.count <= 1}
                  onClick={() => handleQuantityChange(key, value.count - 1)}
                >
                  <RemoveIcon fontSize="small" />
                </IconButton>
                <Typography variant="body2" sx={{ minWidth: '1.5em', textAlign: 'center' }}>
                  {value.count}
                </Typography>
                <IconButton
                  size="small"
                  aria-label={`increase quantity of ${value.displayText}`}
                  onClick={() => handleQuantityChange(key, value.count + 1)}
                >
                  <AddIcon fontSize="small" />
                </IconButton>
              </Stack>
            }
          >
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
