import React from 'react';
import {
  Box,
  Button,
  IconButton,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import RemoveIcon from '@mui/icons-material/Remove';
import DeleteIcon from '@mui/icons-material/Delete';

const IngredientRowsEditor = ({ label, rows, onChange }) => {
  const handleNameChange = (index, name) => {
    onChange(rows.map((row, i) => (i === index ? { ...row, name } : row)));
  };

  const handleQtyChange = (index, qty) => {
    if (qty < 1) return;
    onChange(rows.map((row, i) => (i === index ? { ...row, qty } : row)));
  };

  const handleRemove = (index) => {
    onChange(rows.filter((_, i) => i !== index));
  };

  const handleAdd = () => {
    onChange([...rows, { name: '', qty: 1 }]);
  };

  return (
    <Box>
      <Typography variant="subtitle2" gutterBottom>
        {label}
      </Typography>
      <Stack spacing={1}>
        {rows.map((row, index) => (
          <Stack key={index} direction="row" spacing={1} alignItems="center">
            <TextField
              size="small"
              placeholder="Ingredient name"
              fullWidth
              value={row.name}
              onChange={(e) => handleNameChange(index, e.target.value)}
            />
            <IconButton
              size="small"
              aria-label={`decrease quantity of row ${index + 1}`}
              disabled={row.qty <= 1}
              onClick={() => handleQtyChange(index, row.qty - 1)}
            >
              <RemoveIcon fontSize="small" />
            </IconButton>
            <Typography variant="body2" sx={{ minWidth: '1.5em', textAlign: 'center' }}>
              {row.qty}
            </Typography>
            <IconButton
              size="small"
              aria-label={`increase quantity of row ${index + 1}`}
              onClick={() => handleQtyChange(index, row.qty + 1)}
            >
              <AddIcon fontSize="small" />
            </IconButton>
            <IconButton
              size="small"
              aria-label={`remove row ${index + 1}`}
              onClick={() => handleRemove(index)}
            >
              <DeleteIcon fontSize="small" />
            </IconButton>
          </Stack>
        ))}
      </Stack>
      <Button size="small" startIcon={<AddIcon />} onClick={handleAdd} sx={{ mt: 1 }}>
        Add ingredient
      </Button>
    </Box>
  );
};

export default IngredientRowsEditor;
