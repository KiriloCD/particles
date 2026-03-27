//base on // Hierarchical Spatial Hash Grid: HSHG https://github.com/kirbysayshi/HSHG

(function (root) {
   
    function testAABBOverlap(objA, objB) {
        
        if (objA.aabbMaxX < objB.aabbMinX || objA.aabbMinX > objB.aabbMaxX) return false;
        if (objA.aabbMaxY < objB.aabbMinY || objA.aabbMinY > objB.aabbMaxY) return false;
        return true;
    }

    
    function getLongestAABBEdge(obj) {
        const w = obj.aabbMaxX - obj.aabbMinX;
        const h = obj.aabbMaxY - obj.aabbMinY;
        return w > h ? w : h;
    }

    function Grid(cellSize, cellCount, parentHierarchy) {
        this.cellSize = cellSize;
        this.inverseCellSize = 1 / cellSize;
        this.rowColumnCount = ~~Math.sqrt(cellCount);
        this.xyHashMask = this.rowColumnCount - 1;
        this.occupiedCells = [];
        this.allCells = Array(this.rowColumnCount * this.rowColumnCount);
        this.allObjects = [];
        this._parentHierarchy = parentHierarchy;
    }

    Grid.prototype.initCells = function () {
        const gridLength = this.allCells.length;
        const wh = this.rowColumnCount;
        for (let i = 0; i < gridLength; i++) {
            const cell = new Cell();
            const y = ~~(i / wh);
            const x = ~~(i - (y * wh));
            cell.neighborOffsets = [];
            for (let ody = -1; ody <= 1; ody++) {
                for (let odx = -1; odx <= 1; odx++) {
                    let nx = x + odx, ny = y + ody;
                    
                    if (nx >= 0 && nx < wh && ny >= 0 && ny < wh) {
                        cell.neighborOffsets.push(odx + ody * wh);
                    }
                }
            }
            cell.allCellsIndex = i;
            this.allCells[i] = cell;
        }
    };

    Grid.prototype.toHash = function (x, y) {
        
        let xH = ~~(x * this.inverseCellSize) & this.xyHashMask;
        let yH = ~~(y * this.inverseCellSize) & this.xyHashMask;
        return xH + yH * this.rowColumnCount;
    };

    Grid.prototype.addObject = function (obj, hash) {
       
        const objHash = hash !== undefined ? hash : this.toHash(obj.aabbMinX, obj.aabbMinY);
        let targetCell = this.allCells[objHash];
        
        if (targetCell.objectContainer.length === 0) {
            targetCell.occupiedCellsIndex = this.occupiedCells.length;
            this.occupiedCells.push(targetCell);
        }
        
        obj.HSHG.objectContainerIndex = targetCell.objectContainer.length;
        obj.HSHG.hash = objHash;
        obj.HSHG.grid = this;
        obj.HSHG.allGridObjectsIndex = this.allObjects.length;
        
        targetCell.objectContainer.push(obj);
        this.allObjects.push(obj);
    };

    Grid.prototype.removeObject = function (obj) {
        const meta = obj.HSHG;
        const cell = this.allCells[meta.hash];
        
        // Fast Array Removal (Swap and Pop)
        if (cell.objectContainer.length === 1) {
            cell.objectContainer.pop(); 
            // Видаляємо клітинку зі списку "зайнятих"
            const lastOccupied = this.occupiedCells.pop();
            if (lastOccupied !== cell) {
                lastOccupied.occupiedCellsIndex = cell.occupiedCellsIndex;
                this.occupiedCells[cell.occupiedCellsIndex] = lastOccupied;
            }
        } else {
            const lastObj = cell.objectContainer.pop();
            if (lastObj !== obj) {
                lastObj.HSHG.objectContainerIndex = meta.objectContainerIndex;
                cell.objectContainer[meta.objectContainerIndex] = lastObj;
            }
        }

        const lastGridObj = this.allObjects.pop();
        if (lastGridObj !== obj) {
            lastGridObj.HSHG.allGridObjectsIndex = meta.allGridObjectsIndex;
            this.allObjects[meta.allGridObjectsIndex] = lastGridObj;
        }
    };

    function Cell() {
        this.objectContainer = [];
        this.neighborOffsets = null;
    }

    function HSHG(config) {
        config = config || {};
        this.MAX_DENSITY = config.maxDensity || 1/8;
        this.INIT_LEN = config.initialGridLength || 256;
        this.H_FACTOR = config.hierarchyFactor || 2;
        this._grids = [];
        this._globalObjects = [];
    }

    HSHG.prototype.addObject = function (obj) {
        
        const size = getLongestAABBEdge(obj);
        
        obj.HSHG = { globalObjectsIndex: this._globalObjects.length, grid: null, hash: null };
        this._globalObjects.push(obj);

        let targetGrid = null;
        for (let i = 0; i < this._grids.length; i++) {
            if (size <= this._grids[i].cellSize) {
                targetGrid = this._grids[i];
                break;
            }
        }

        if (!targetGrid) {
            let newSize = this._grids.length > 0 ? this._grids[this._grids.length-1].cellSize : size * 1.5;
            while (size > newSize) newSize *= this.H_FACTOR;
            targetGrid = new Grid(newSize, this.INIT_LEN, this);
            targetGrid.initCells();
            this._grids.push(targetGrid);
            // Сортуємо сітки від дрібних до великих
            this._grids.sort((a, b) => a.cellSize - b.cellSize);
        }
        targetGrid.addObject(obj);
    };

    HSHG.prototype.removeObject = function (obj) {
        const meta = obj.HSHG;
        if (!meta) return;
        
        const lastGlobal = this._globalObjects.pop();
        if (lastGlobal !== obj) {
            lastGlobal.HSHG.globalObjectsIndex = meta.globalObjectsIndex;
            this._globalObjects[meta.globalObjectsIndex] = lastGlobal;
        }
        
        if (meta.grid) {
            meta.grid.removeObject(obj);
            if (meta.grid.allObjects.length === 0) {
                // Видаляємо порожню сітку для економії, якщо треба
                 this._grids = this._grids.filter(g => g !== meta.grid);
            }
        }
        delete obj.HSHG;
    };

    
    HSHG.prototype.update = function () {
        for (let i = 0; i < this._globalObjects.length; i++) {
            const obj = this._globalObjects[i];
            const meta = obj.HSHG;
            
            // Обчислюємо новий хеш на основі поточних координат
            const newHash = meta.grid.toHash(obj.aabbMinX, obj.aabbMinY);
            
            
            if (newHash !== meta.hash) {
                meta.grid.removeObject(obj);
                meta.grid.addObject(obj, newHash);
            }
        }
    };

    HSHG.prototype.queryForCollisionPairs = function (callback) {
        for (let i = 0; i < this._grids.length; i++) {
            const grid = this._grids[i];
            
            
            for (let j = 0; j < grid.occupiedCells.length; j++) {
                const cell = grid.occupiedCells[j];
                const objs = cell.objectContainer;
                const len = objs.length;

                // 1. Внутрішньоклітинні перевірки
                for (let k = 0; k < len; k++) {
                    const objK = objs[k];
                    for (let l = k + 1; l < len; l++) {
                        const objL = objs[l];
                        if (testAABBOverlap(objK, objL)) callback(objK, objL);
                    }
                    
                    // 2. Перевірка з вищими cітками
                   
                    for (let h = i + 1; h < this._grids.length; h++) {
                        const bigGrid = this._grids[h];
                        const bigHash = bigGrid.toHash(objK.aabbMinX, objK.aabbMinY);
                        const bigCell = bigGrid.allCells[bigHash];
                        
                        // Перевіряємо власну клітинку великої сітки
                        const bigObjs = bigCell.objectContainer;
                        for (let b = 0; b < bigObjs.length; b++) {
                             if (testAABBOverlap(objK, bigObjs[b])) callback(objK, bigObjs[b]);
                        }

                        // Перевіряємо сусідів великої сітки
                        for (let n = 0; n < bigCell.neighborOffsets.length; n++) {
                            const adjBig = bigGrid.allCells[bigCell.allCellsIndex + bigCell.neighborOffsets[n]];
                            for (let b = 0; b < adjBig.objectContainer.length; b++) {
                                if (testAABBOverlap(objK, adjBig.objectContainer[b])) callback(objK, adjBig.objectContainer[b]);
                            }
                        }
                    }
                }

                // 3. Сусіди всередині поточної сітки
                for (let n = 0; n < cell.neighborOffsets.length; n++) {
                    const adjIdx = cell.allCellsIndex + cell.neighborOffsets[n];
                    // Перевіряємо тільки більтші
                    if (adjIdx <= cell.allCellsIndex) continue;
                    
                    const adjCell = grid.allCells[adjIdx];
                    if (adjCell.objectContainer.length > 0) {
                        for (let k = 0; k < len; k++) {
                            for (let l = 0; l < adjCell.objectContainer.length; l++) {
                                if (testAABBOverlap(objs[k], adjCell.objectContainer[l])) 
                                    callback(objs[k], adjCell.objectContainer[l]);
                            }
                        }
                    }
                }
            }
        }
    };

    root.HSHG = HSHG;
})(window);