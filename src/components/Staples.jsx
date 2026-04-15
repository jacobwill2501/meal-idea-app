import React, { useEffect, useState } from 'react';
import {
  Box,
  Button,
  Checkbox,
  Divider,
  IconButton,
  List,
  ListItem,
  ListItemText,
  Stack,
  TextField,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import DeleteIcon from '@mui/icons-material/Delete';
import ShoppingCartIcon from '@mui/icons-material/ShoppingCart';
import {
  getAllStaples,
  addStaple,
  toggleStaple,
  deleteStaple,
  resetAllStaples,
} from '../services/staplesService';
import { addStapleItems } from '../services/groceryService';

const Staples = () => {
  const [staples, setStaples] = useState([]);
  const [newName, setNewName] = useState('');

  const fetchStaples = async () => {
    const data = await getAllStaples();
    setStaples(data);
  };

  useEffect(() => {
    fetchStaples();
  }, []);

  const handleAdd = async () => {
    if (!newName.trim()) return;
    await addStaple(newName.trim());
    setNewName('');
    await fetchStaples();
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter') handleAdd();
  };

  const handleToggle = async (staple) => {
    await toggleStaple(staple.id, !staple.checked);
    setStaples((prev) =>
      prev.map((s) => (s.id === staple.id ? { ...s, checked: !s.checked } : s))
    );
  };

  const handleDelete = async (id) => {
    await deleteStaple(id);
    setStaples((prev) => prev.filter((s) => s.id !== id));
  };

  const handleReset = async () => {
    await resetAllStaples(staples);
    setStaples((prev) => prev.map((s) => ({ ...s, checked: false })));
  };

  const handleAddToGrocery = async () => {
    await addStapleItems(staples);
    alert('Staples added to Grocery List!');
  };

  const unchecked = staples.filter((s) => !s.checked);
  const checked = staples.filter((s) => s.checked);

  return (
    <Box>
      <Stack direction="row" spacing={2} mb={2}>
        <TextField
          label="Add staple item"
          fullWidth
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
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

      <List disablePadding>
        {unchecked.map((staple) => (
          <ListItem
            key={staple.id}
            disableGutters
            secondaryAction={
              <IconButton edge="end" onClick={() => handleDelete(staple.id)}>
                <DeleteIcon />
              </IconButton>
            }
          >
            <Checkbox checked={false} onChange={() => handleToggle(staple)} />
            <ListItemText primary={staple.name} />
          </ListItem>
        ))}

        {checked.length > 0 && (
          <>
            <Divider sx={{ my: 1 }} />
            {checked.map((staple) => (
              <ListItem
                key={staple.id}
                disableGutters
                secondaryAction={
                  <IconButton edge="end" onClick={() => handleDelete(staple.id)}>
                    <DeleteIcon />
                  </IconButton>
                }
              >
                <Checkbox checked={true} onChange={() => handleToggle(staple)} />
                <ListItemText
                  primary={staple.name}
                  sx={{ textDecoration: 'line-through', color: 'text.disabled' }}
                />
              </ListItem>
            ))}
          </>
        )}
      </List>

      {staples.length > 0 && (
        <Box display="flex" justifyContent="space-between" mt={2}>
          <Button
            variant="outlined"
            color="success"
            startIcon={<ShoppingCartIcon />}
            onClick={handleAddToGrocery}
          >
            Add to Grocery List
          </Button>
          <Button variant="outlined" onClick={handleReset}>
            Reset for new week
          </Button>
        </Box>
      )}
    </Box>
  );
};

export default Staples;
