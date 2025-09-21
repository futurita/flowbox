# Linda's Journey Map

A responsive, interactive user journey map that displays Linda's experience seeking information about government grants. Built with modern web technologies and featuring a clean, minimal design.

## Features

### 🎯 **Table-Based Layout**
- Clean grid structure with 4 main rows and 10 journey stages
- Responsive design that works on desktop and mobile devices
- Horizontal scrolling for smaller screens

### ✏️ **Column Editing**
- Click on any column header to edit the entire column
- Modal form for updating stage, activities, feelings, and opportunities
- Real-time updates to the journey map

### 🎨 **Visual Elements**
- Color-coded row labels for easy identification
- Mood indicators with emojis and visual feedback
- Professional styling with subtle shadows and borders

### 🔄 **Drag & Drop Functionality**
- Drag individual journey blocks to reorder them
- Visual feedback during drag operations
- Automatic data reordering and re-rendering

### 📱 **Responsive Design**
- Mobile-friendly interface
- Optimized for various screen sizes
- Touch-friendly interactions

## File Structure

```
├── index.html          # Main HTML structure
├── styles.css          # CSS styling and responsive design
├── script.js           # JavaScript functionality and data
└── README.md           # This documentation
```

## How to Use

### Viewing the Journey Map
1. Open `index.html` in a web browser
2. The journey map displays Linda's 10-stage journey
3. Scroll horizontally to see all stages
4. Hover over elements for interactive feedback

### Editing Columns
1. Click on any column header (Stage 1, Stage 2, etc.)
2. A modal will open with editable fields
3. Update the content as needed
4. Click "Save Changes" to apply updates

### Reordering Journey Stages
1. Click and drag any journey block
2. Drop it on another block to swap positions
3. The entire column will reorder automatically
4. Visual feedback shows the drag operation

## Journey Map Structure

The map follows the structure from the original image:

- **Stage of Journey**: High-level phases (Identifies Need, Looks for Info, Finds Info, Seeks Help)
- **Activities**: Specific actions Linda takes at each stage
- **Feelings and Needs**: Emotional state and underlying needs with mood indicators
- **Potential Opportunities**: Improvement suggestions (global list at bottom)

## Technical Details

- **HTML5**: Semantic markup and accessibility
- **CSS3**: Grid layout, flexbox, and modern styling
- **Vanilla JavaScript**: No external dependencies
- **Drag & Drop API**: Native browser support
- **CSS Grid**: Responsive table layout

## Browser Support

- Chrome 60+
- Firefox 55+
- Safari 12+
- Edge 79+

## Customization

The journey map can be easily customized by:

1. **Modifying Data**: Edit the `journeyData` array in `script.js`
2. **Styling**: Update colors and layout in `styles.css`
3. **Adding Features**: Extend the `JourneyMap` class in `script.js`

## License

This project is open source and available under the MIT License.
