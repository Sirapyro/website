/*!
 * VisualEditor DataModel Document class.
 *
 * @copyright 2011-2017 VisualEditor Team and others; see http://ve.mit-license.org
 */

/**
 * DataModel document.
 *
 * WARNING: The data parameter is passed by reference. Do not modify a data array after passing
 * it to this constructor, and do not construct multiple Documents with the same data array. If you
 * need to do these things, make a deep copy (ve#copy) of the data array and operate on the
 * copy.
 *
 * @class
 * @extends ve.Document
 * @constructor
 * @param {Array|ve.dm.ElementLinearData|ve.dm.FlatLinearData} data Raw linear model data,
 *  ElementLinearData or FlatLinearData to be split
 * @param {HTMLDocument} [htmlDocument] HTML document the data was converted from, if any.
 *  If omitted, a new document will be created. If data is an HTMLDocument, this parameter is
 *  ignored.
 * @param {ve.dm.Document} [parentDocument] Document to use as root for created nodes
 * @param {ve.dm.InternalList} [internalList] Internal list to clone; passed when creating a document slice
 * @param {Array} [innerWhitespace] Inner whitespace to clone; passed when creating a document slice
 * @param {string} [lang] Language code
 * @param {string} [dir='ltr'] Directionality (ltr/rtl)
 */
ve.dm.Document = function VeDmDocument( data, htmlDocument, parentDocument, internalList, innerWhitespace, lang, dir ) {
	var fullData, result, split, doc, root;

	// Parent constructor
	ve.dm.Document.super.call( this, new ve.dm.DocumentNode() );

	// Initialization
	split = true;
	doc = parentDocument || this;
	root = this.documentNode;

	this.lang = lang || 'en';
	this.dir = dir || 'ltr';

	this.documentNode.setRoot( root );
	// ve.Document already called setDocument(), but it could be that doc !== this
	// so call it again
	this.documentNode.setDocument( doc );
	this.internalList = internalList ? internalList.clone( this ) : new ve.dm.InternalList( this );
	this.innerWhitespace = innerWhitespace ? ve.copy( innerWhitespace ) : new Array( 2 );

	// Properties
	this.parentDocument = parentDocument;
	this.completeHistory = [];
	this.storeLengthAtHistoryLength = [ 0 ];
	this.nodesByType = {};

	if ( data instanceof ve.dm.ElementLinearData ) {
		// Pre-split ElementLinearData
		split = false;
		fullData = data;
	} else if ( data instanceof ve.dm.FlatLinearData ) {
		// Element + Meta linear data
		fullData = data;
	} else {
		// Raw linear model data
		fullData = new ve.dm.FlatLinearData(
			new ve.dm.IndexValueStore(),
			Array.isArray( data ) ? data : []
		);
	}
	this.store = fullData.getStore();
	this.htmlDocument = htmlDocument || ve.createDocumentFromHtml( '' );

	if ( split ) {
		result = this.constructor.static.splitData( fullData );
		this.data = result.elementData;
		this.metadata = result.metaData;
	} else {
		this.data = fullData;
		this.metadata = new ve.dm.MetaLinearData( this.data.getStore(), new Array( 1 + this.data.getLength() ) );
	}
};

/* Inheritance */

OO.inheritClass( ve.dm.Document, ve.Document );

/* Events */

/**
 * @event precommit
 * Emitted when a transaction is about to be committed.
 * @param {ve.dm.Transaction} tx Transaction that is about to be committed
 */

/**
 * @event transact
 * Emitted when a transaction has been committed.
 * @param {ve.dm.Transaction} tx Transaction that was just processed
 */

/* Static methods */

/**
 * Split data into element data and meta data.
 *
 * @static
 * @param {ve.dm.FlatLinearData} fullData Full data from converter
 * @return {Object} Object containing element linear data and meta linear data (if processed)
 */
ve.dm.Document.static.splitData = function ( fullData ) {
	var i, len, offset, meta, elementData, metaData;

	elementData = new ve.dm.ElementLinearData( fullData.getStore() );
	// Sparse array containing the metadata for each offset
	// Each element is either undefined, or an array of metadata elements
	// Because the indexes in the metadata array represent offsets in the data array, the
	// metadata array has one element more than the data array.
	metaData = new ve.dm.MetaLinearData( fullData.getStore() );

	// Separate element data and metadata and build node tree
	for ( i = 0, len = fullData.getLength(); i < len; i++ ) {
		if ( !fullData.isElementData( i ) ) {
			// Add to element linear data
			elementData.push( fullData.getData( i ) );
		} else {
			// Element data
			if ( fullData.isOpenElementData( i ) &&
				ve.dm.metaItemFactory.lookup( fullData.getType( i ) )
			) {
				// Metadata
				meta = fullData.getData( i );
				offset = elementData.getLength();
				// Put the meta data in the meta-linmod
				if ( !metaData.getData( offset ) ) {
					metaData.setData( offset, [] );
				}
				metaData.getData( offset ).push( meta );
				// Skip close element
				i++;
				continue;
			}
			// Add to element linear data
			elementData.push( fullData.getData( i ) );
		}
	}
	// Pad out the metadata length to element data length + 1
	if ( metaData.getLength() < elementData.getLength() + 1 ) {
		metaData.data = metaData.data.concat(
			new Array( 1 + elementData.getLength() - metaData.getLength() )
		);
	}

	return {
		elementData: elementData,
		metaData: metaData
	};
};

/**
 * Apply annotations to content data.
 *
 * This method modifies data in place.
 *
 * @static
 * @param {ve.dm.ElementLinearData|Array} data Data to apply annotations to
 * @param {ve.dm.AnnotationSet} annotationSet Annotations to apply
 * @param {boolean} [replaceComparable] Whether to remove annotations from the data which are comparable to those in annotationSet
 * @param {ve.dm.IndexValueStore} [store] Store associated with the data; only needs to be provided if that data is associated with a different store than annotationSet
 * @param {boolean} [prepend] Whether to prepend annotationSet to the existing annotations
 */
ve.dm.Document.static.addAnnotationsToData = function ( data, annotationSet, replaceComparable, store, prepend ) {
	var i, length, allowedAnnotations, existingAnnotations, newAnnotationSet,
		ignoreChildrenDepth = 0,
		offset = prepend ? 0 : undefined;

	if ( annotationSet.isEmpty() ) {
		// Nothing to do
		return;
	}
	if ( store ) {
		store.merge( annotationSet.getStore() );
	} else {
		store = annotationSet.getStore();
	}
	if ( !( data instanceof ve.dm.ElementLinearData ) ) {
		data = new ve.dm.ElementLinearData( store, data );
	}

	// Apply annotations to data
	for ( i = 0, length = data.getLength(); i < length; i++ ) {
		if ( data.isElementData( i ) && ve.dm.nodeFactory.shouldIgnoreChildren( data.getType( i ) ) ) {
			ignoreChildrenDepth += data.isOpenElementData( i ) ? 1 : -1;
		}
		if ( ignoreChildrenDepth ) {
			continue;
		}
		// eslint-disable-next-line no-loop-func
		allowedAnnotations = annotationSet.filter( function ( ann ) {
			return data.canTakeAnnotationAtOffset( i, ann, true );
		} );
		existingAnnotations = data.getAnnotationsFromOffset( i, true );
		if ( !existingAnnotations.isEmpty() ) {
			newAnnotationSet = existingAnnotations;
			if ( replaceComparable ) {
				newAnnotationSet = newAnnotationSet.withoutComparableSet( allowedAnnotations );
			}
			newAnnotationSet.addSet( allowedAnnotations, offset );
		} else {
			newAnnotationSet = allowedAnnotations;
		}
		data.setAnnotationsAtOffset( i, newAnnotationSet );
	}
};

/**
 * Provide a new, empty Document.
 *
 * @param {string} [paragraphType='empty'] Paragraph type: 'empty', 'wrapper' or null for a regular paragraph
 * @return {ve.dm.Document}
 */
ve.dm.Document.static.newBlankDocument = function ( paragraphType ) {
	var paragraph = { type: 'paragraph' };

	paragraphType = paragraphType === undefined ? 'empty' : paragraphType;

	if ( paragraphType ) {
		ve.setProp( paragraph, 'internal', 'generated', paragraphType );
	}

	return new ve.dm.Document( [
		paragraph,
		{ type: '/paragraph' },
		{ type: 'internalList' },
		{ type: '/internalList' }
	] );
};

/* Methods */

/**
 * @inheritdoc
 */
ve.dm.Document.prototype.getDocumentNode = function () {
	if ( !this.documentNode.length && !this.documentNode.getDocument().buildingNodeTree ) {
		this.buildNodeTree();
	}
	return this.documentNode;
};

/**
 * Build the node tree.
 */
ve.dm.Document.prototype.buildNodeTree = function () {
	var i, len, node, children,
		currentStack, parentStack, nodeStack, currentNode, doc,
		textLength = 0,
		inTextNode = false;

	// Build a tree of nodes and nodes that will be added to them after a full scan is complete,
	// then from the bottom up add nodes to their potential parents. This avoids massive length
	// updates being broadcast upstream constantly while building is underway.
	currentStack = [];
	parentStack = [ this.documentNode ];
	// Stack of stacks
	nodeStack = [ parentStack, currentStack ];
	currentNode = this.documentNode;
	doc = this.documentNode.getDocument();

	// Separate element data and metadata and build node tree
	for ( i = 0, len = this.data.getLength(); i < len; i++ ) {
		if ( !this.data.isElementData( i ) ) {
			// Text node opening
			if ( !inTextNode ) {
				// Create a lengthless text node
				node = new ve.dm.TextNode();
				node.setDocument( doc );
				// Put the node on the current inner stack
				currentStack.push( node );
				currentNode = node;
				// Set a flag saying we're inside a text node
				inTextNode = true;
			}
			// Track the length
			textLength++;
		} else {
			// Text node closing
			if ( inTextNode ) {
				// Finish the text node by setting the length
				currentNode.setLength( textLength );
				// Put the state variables back as they were
				currentNode = parentStack[ parentStack.length - 1 ];
				inTextNode = false;
				textLength = 0;
			}
			// Element open/close
			if ( this.data.isOpenElementData( i ) ) {
				// Branch or leaf node opening
				// Create a childless node
				node = ve.dm.nodeFactory.createFromElement( this.data.getData( i ) );
				node.setDocument( doc );
				// Put the childless node on the current inner stack
				currentStack.push( node );
				if ( ve.dm.nodeFactory.canNodeHaveChildren( node.getType() ) ) {
					// Create a new inner stack for this node
					parentStack = currentStack;
					currentStack = [];
					nodeStack.push( currentStack );
					currentNode = node;
				} else {
					// Assert that the next element is a closing element for this node,
					// and skip over it.
					if (
						!this.data.isCloseElementData( i + 1 ) ||
						this.data.getType( i + 1 ) !== this.data.getType( i )
					) {
						throw new Error( 'Opening element for node that cannot have children must be followed by closing element' );
					}
					i++;
				}
			} else {
				// Branch or leaf node closing
				if ( this.data.getType( i ) !== currentNode.getType() ) {
					throw new Error( 'Expected closing for ' + currentNode.getType() +
						' but got closing for ' + this.data.getType( i ) );
				}
				// Pop this node's inner stack from the outer stack. It'll have all of the
				// node's child nodes fully constructed
				children = nodeStack.pop();
				currentStack = parentStack;
				parentStack = nodeStack[ nodeStack.length - 2 ];
				if ( !parentStack ) {
					// This can only happen if we got unbalanced data
					throw new Error( 'Unbalanced input passed to document' );
				}
				// Attach the children to the node
				ve.batchSplice( currentNode, 0, 0, children );
				currentNode = parentStack[ parentStack.length - 1 ];
			}
		}
	}

	if ( inTextNode ) {
		// Text node ended by end-of-input rather than by an element
		currentNode.setLength( textLength );
		// Don't bother updating currentNode et al, we don't use them below
	}

	// State variable that allows nodes to know that they are being
	// appended in order. Used by ve.dm.InternalList.
	doc.buildingNodeTree = true;

	// The end state is nodeStack = [ [this.documentNode], [ array, of, its, children ] ]
	// so attach all nodes in currentStack to the root node
	if ( nodeStack.length > 2 ) {
		// A node was opened but never closed
		throw new Error( 'Unbalanced input passed to document' );
	}
	ve.batchSplice( this.documentNode, 0, 0, currentStack );
	this.updateNodesByType( [ this.documentNode ], [] );

	doc.buildingNodeTree = false;
};

/**
 * Get the length of the document. This is also the highest valid offset in the document.
 *
 * @return {number} Length of the document
 */
ve.dm.Document.prototype.getLength = function () {
	return this.data.getLength();
};

/**
 * Apply a transaction's effects on the content data.
 *
 * @method
 * @param {ve.dm.Transaction} transaction Transaction to apply
 * @param {boolean} isStaging Transaction is being applied in staging mode
 * @fires precommit
 * @fires transact
 * @throws {Error} Cannot commit a transaction that has already been committed
 */
ve.dm.Document.prototype.commit = function ( transaction, isStaging ) {
	if ( transaction.hasBeenApplied() ) {
		throw new Error( 'Cannot commit a transaction that has already been committed' );
	}
	this.emit( 'precommit', transaction );
	new ve.dm.TransactionProcessor( this, transaction, isStaging ).process();
	this.completeHistory.push( transaction );
	this.storeLengthAtHistoryLength[ this.completeHistory.length ] = this.store.getLength();
	this.emit( 'transact', transaction );
};

/**
 * Get a slice or copy of the document data.
 *
 * @method
 * @param {ve.Range} [range] Range of data to get, all data will be given by default
 * @param {boolean} [deep=false] Whether to return a deep copy (WARNING! This may be very slow)
 * @return {Array} Slice or copy of document data
 */
ve.dm.Document.prototype.getData = function ( range, deep ) {
	return this.data.getDataSlice( range, deep );
};

/**
 * Get a slice or copy of the document metadata.
 *
 * @method
 * @param {ve.Range} [range] Range of metadata to get, all metadata will be given by default
 * @param {boolean} [deep=false] Whether to return a deep copy (WARNING! This may be very slow)
 * @return {Array} Slice or copy of document metadata
 */
ve.dm.Document.prototype.getMetadata = function ( range, deep ) {
	return this.metadata.getDataSlice( range, deep );
};

/**
 * Get the HTMLDocument associated with this document.
 *
 * @method
 * @return {HTMLDocument} Associated document
 */
ve.dm.Document.prototype.getHtmlDocument = function () {
	return this.htmlDocument;
};

/**
 * Get the document's index-value store
 *
 * @method
 * @return {ve.dm.IndexValueStore} The document's index-value store
 */
ve.dm.Document.prototype.getStore = function () {
	return this.store;
};

/**
 * Get the document's internal list
 *
 * @return {ve.dm.InternalList} The document's internal list
 */
ve.dm.Document.prototype.getInternalList = function () {
	return this.internalList;
};

/**
 * Get the document's inner whitespace
 *
 * @return {Array} The document's inner whitespace
 */
ve.dm.Document.prototype.getInnerWhitespace = function () {
	return this.innerWhitespace;
};

/**
 * Clone a sub-document from a shallow copy of this document.
 *
 * The new document's elements, internal list and store will only contain references to data within the slice.
 *
 * @param {ve.dm.Selection} selection Selection to create sub-document from
 * @return {ve.dm.DocumentSlice} New document
 */
ve.dm.Document.prototype.shallowCloneFromSelection = function ( selection ) {
	var i, l, linearData, ranges, tableRange,
		data = [];

	if ( selection instanceof ve.dm.LinearSelection ) {
		return this.shallowCloneFromRange( selection.getRange() );
	} else if ( selection instanceof ve.dm.TableSelection ) {
		ranges = selection.getTableSliceRanges();
		for ( i = 0, l = ranges.length; i < l; i++ ) {
			data = data.concat( this.data.slice( ranges[ i ].start, ranges[ i ].end ) );
		}
		linearData = new ve.dm.ElementLinearData( this.getStore(), data );

		tableRange = new ve.Range( 0, data.length );

		// Copy over the internal list
		ve.batchSplice(
			linearData.data, linearData.getLength(), 0,
			this.getData( this.getInternalList().getListNode().getOuterRange(), true )
		);

		// The internalList is rebuilt by the document constructor
		return new ve.dm.TableSlice(
			linearData, undefined, undefined, this.getInternalList(), tableRange
		);
	} else {
		return this.shallowCloneFromRange( new ve.Range( 0 ) );
	}
};

/**
 * Clone a sub-document from a shallow copy of this document.
 *
 * The new document's elements, internal list and store will only contain references to data within the slice.
 *
 * @param {ve.Range} [range] Range of data to slice; defaults to whole document
 * @return {ve.dm.DocumentSlice} New document
 */
ve.dm.Document.prototype.shallowCloneFromRange = function ( range ) {
	var listRange, i, first, last, firstNode, lastNode,
		linearData, slice, originalRange, balancedRange,
		balancedNodes, needsContext, contextElement, isContent,
		startNode, endNode, selection,
		balanceOpenings = [],
		balanceClosings = [],
		contextOpenings = [],
		contextClosings = [];

	listRange = this.getInternalList().getListNode().getOuterRange();

	if ( !range ) {
		// Default to the whole document
		linearData = this.data.sliceObject();
		originalRange = balancedRange = new ve.Range( 0, listRange.start );
	} else {
		startNode = this.getBranchNodeFromOffset( range.start );
		endNode = this.getBranchNodeFromOffset( range.end );
		selection = this.selectNodes( range, 'siblings' );

		// Fix up selection to remove empty items in unwrapped nodes
		// TODO: fix this is selectNodes
		while ( selection[ 0 ] && selection[ 0 ].range && selection[ 0 ].range.isCollapsed() && !selection[ 0 ].node.isWrapped() ) {
			selection.shift();
		}

		i = selection.length - 1;
		while ( selection[ i ] && selection[ i ].range && selection[ i ].range.isCollapsed() && !selection[ i ].node.isWrapped() ) {
			selection.pop();
			i--;
		}

		if ( selection.length === 0 || range.isCollapsed() ) {
			// Nothing selected
			linearData = new ve.dm.ElementLinearData( this.getStore(), [
				{ type: 'paragraph', internal: { generated: 'empty' } },
				{ type: 'paragraph' }
			] );
			originalRange = balancedRange = new ve.Range( 1 );
		} else if ( startNode === endNode ) {
			// Nothing to balance
			balancedNodes = selection;
		} else {
			// Selection is not balanced
			first = selection[ 0 ];
			last = selection[ selection.length - 1 ];
			firstNode = first.node;
			lastNode = last.node;
			while ( !firstNode.isWrapped() ) {
				firstNode = firstNode.getParent();
			}
			while ( !lastNode.isWrapped() ) {
				lastNode = lastNode.getParent();
			}

			if ( first.range ) {
				while ( true ) {
					while ( !startNode.isWrapped() ) {
						startNode = startNode.getParent();
					}
					balanceOpenings.push( startNode.getClonedElement() );
					if ( startNode === firstNode ) {
						break;
					}
					startNode = startNode.getParent();
				}
			}

			if ( last !== first && last.range ) {
				while ( true ) {
					while ( !endNode.isWrapped() ) {
						endNode = endNode.getParent();
					}
					balanceClosings.push( { type: '/' + endNode.getType() } );
					if ( endNode === lastNode ) {
						break;
					}
					endNode = endNode.getParent();
				}
			}

			balancedNodes = this.selectNodes(
				new ve.Range( firstNode.getOuterRange().start, lastNode.getOuterRange().end ),
				'covered'
			);
		}

		// eslint-disable-next-line no-inner-declarations
		function nodeNeedsContext( node ) {
			return node.getParentNodeTypes() !== null || node.isContent();
		}

		if ( !balancedRange ) {
			// Check if any of the balanced siblings need more context for insertion anywhere
			needsContext = false;
			for ( i = balancedNodes.length - 1; i >= 0; i-- ) {
				if ( nodeNeedsContext( balancedNodes[ i ].node ) ) {
					needsContext = true;
					break;
				}
			}

			if ( needsContext ) {
				startNode = balancedNodes[ 0 ].node;
				// Keep wrapping until the outer node can be inserted anywhere
				while ( startNode.getParent() && nodeNeedsContext( startNode ) ) {
					isContent = startNode.isContent();
					startNode = startNode.getParent();
					contextElement = startNode.getClonedElement();
					if ( isContent ) {
						ve.setProp( contextElement, 'internal', 'generated', 'wrapper' );
					}
					contextOpenings.push( contextElement );
					contextClosings.push( { type: '/' + contextElement.type } );
				}
			}

			// Final data:
			//  contextOpenings + balanceOpenings + data slice + balanceClosings + contextClosings
			linearData = new ve.dm.ElementLinearData(
				this.getStore(),
				contextOpenings.reverse()
					.concat( balanceOpenings.reverse() )
					.concat( this.data.slice( range.start, range.end ) )
					.concat( balanceClosings )
					.concat( contextClosings )
			);
			originalRange = new ve.Range(
				contextOpenings.length + balanceOpenings.length,
				contextOpenings.length + balanceOpenings.length + range.getLength()
			);
			balancedRange = new ve.Range(
				contextOpenings.length,
				contextOpenings.length + balanceOpenings.length + range.getLength() + balanceClosings.length
			);
		}

		// Shallow copy over the internal list
		ve.batchSplice(
			linearData.data, linearData.getLength(), 0,
			this.getData( listRange )
		);
	}

	// The internalList is rebuilt by the document constructor
	slice = new ve.dm.DocumentSlice(
		linearData, undefined, undefined, this.getInternalList(), originalRange, balancedRange
	);
	return slice;
};

/**
 * Clone a sub-document from a range in this document. The new document's elements, store and internal list
 * will be clones of the ones in this document.
 *
 * @param {ve.Range} [range] Range of data to clone, clones the whole document if ommitted.
 * @return {ve.dm.Document} New document
 */
ve.dm.Document.prototype.cloneFromRange = function ( range ) {
	var listRange = this.getInternalList().getListNode().getOuterRange(),
		data = ve.copy( this.getFullData( range, true ) );
	if ( range && ( range.start > listRange.start || range.end < listRange.end ) ) {
		// The range does not include the entire internal list, so add it
		data = data.concat( this.getFullData( listRange ) );
	}
	return this.cloneWithData( data, true );
};

/**
 * Create a sub-document associated with this document like #cloneFromRange, but without cloning
 * any data from a range in this document: instead, use the specified data.
 *
 * @param {Array|ve.dm.ElementLinearData|ve.dm.FlatLinearData} data Raw linear model data,
 *  ElementLinearData or FlatLinearData
 * @param {boolean} [copyInternalList] Copy the internal list
 * @return {ve.dm.Document} New document
 */
ve.dm.Document.prototype.cloneWithData = function ( data, copyInternalList ) {
	var newDoc;

	if ( Array.isArray( data ) ) {
		data = new ve.dm.FlatLinearData( this.getStore().clone(), data );
	}

	newDoc = new this.constructor(
		data,
		// htmlDocument
		this.getHtmlDocument(),
		// parentDocument
		undefined,
		// internalList
		copyInternalList ? this.getInternalList() : undefined,
		// innerWhitespace
		undefined,
		// lang+dir
		this.getLang(), this.getDir()
	);
	if ( copyInternalList ) {
		// Record the length of the internal list at the time the slice was created so we can
		// reconcile additions properly
		newDoc.origDoc = this;
		newDoc.origInternalListLength = this.internalList.getItemNodeCount();
	}
	return newDoc;
};

/**
 * Get the full document data including metadata.
 *
 * Metadata will be into the document data to produce the "full data" result. If a range is passed,
 * metadata at the edges of the range won't be included unless edgeMetadata is set to true. If
 * no range is passed, the entire document's data is returned and metadata at the edges is
 * included.
 *
 * @param {ve.Range} [range] Range to get full data for. If omitted, all data will be returned
 * @param {boolean} [edgeMetadata=false] Include metadata at the edges of the range
 * @return {Array} Data with metadata interleaved
 */
ve.dm.Document.prototype.getFullData = function ( range, edgeMetadata ) {
	var j, jLen,
		i = range ? range.start : 0,
		iLen = range ? range.end : this.data.getLength(),
		result = [];
	if ( edgeMetadata === undefined ) {
		edgeMetadata = !range;
	}
	while ( i <= iLen ) {
		if ( this.metadata.getData( i ) && ( edgeMetadata || ( i !== range.start && i !== range.end ) ) ) {
			for ( j = 0, jLen = this.metadata.getData( i ).length; j < jLen; j++ ) {
				result.push( this.metadata.getData( i )[ j ] );
				result.push( { type: '/' + this.metadata.getData( i )[ j ].type } );
			}
		}
		if ( i < iLen ) {
			result.push( this.data.getData( i ) );
		}
		i++;
	}
	return result;
};

/**
 * Get the nearest word boundary.
 *
 * @method
 * @param {number} offset Offset to start from
 * @param {number} [direction] Direction to prefer matching offset in, -1 for left and 1 for right
 * @return {number} Nearest word boundary
 */
ve.dm.Document.prototype.getSiblingWordBoundary = function ( offset, direction ) {
	var dataString = new ve.dm.DataString( this.getData() );
	return unicodeJS.wordbreak.moveBreakOffset( direction, dataString, offset, true );
};

/**
 * Get the relative word or character boundary.
 *
 * @method
 * @param {number} offset Offset to start from
 * @param {number} direction Direction to prefer matching offset in, -1 for left and 1 for right
 * @param {string} [unit] Unit [word|character]
 * @return {number} Relative offset
 */
ve.dm.Document.prototype.getRelativeOffset = function ( offset, direction, unit ) {
	var relativeContentOffset, relativeStructuralOffset, newOffset, adjacentDataOffset, isFocusable,
		data = this.data;
	if ( unit === 'word' ) { // word
		// Method getSiblingWordBoundary does not "move/jump" over element data. If passed offset is
		// an element data offset then the same offset is returned - and in such case this method
		// fallback to the other path (character) which does "move/jump" over element data.
		newOffset = this.getSiblingWordBoundary( offset, direction );
		if ( offset === newOffset ) {
			newOffset = this.getRelativeOffset( offset, direction, 'character' );
		}
		return newOffset;
	} else { // character
		// Check if we are adjacent to a focusable node
		adjacentDataOffset = offset + ( direction > 0 ? 0 : -1 );
		if (
			data.isElementData( adjacentDataOffset ) &&
			ve.dm.nodeFactory.isNodeFocusable( data.getType( adjacentDataOffset ) )
		) {
			// We are adjacent to a focusableNode, move inside it
			return offset + direction;
		}
		relativeContentOffset = data.getRelativeContentOffset( offset, direction );
		relativeStructuralOffset = data.getRelativeStructuralOffset( offset, direction, true );
		// Check the structural offset is not in the wrong direction
		if ( ( relativeStructuralOffset - offset < 0 ? -1 : 1 ) !== direction ) {
			relativeStructuralOffset = offset;
		} else {
			isFocusable = ( relativeStructuralOffset - offset < 0 ? -1 : 1 ) === direction &&
				data.isElementData( relativeStructuralOffset + direction ) &&
				ve.dm.nodeFactory.isNodeFocusable( data.getType( relativeStructuralOffset + direction ) );
		}
		// Check if we've moved into a slug or a focusableNode
		if ( isFocusable || this.hasSlugAtOffset( relativeStructuralOffset ) ) {
			if ( isFocusable ) {
				relativeStructuralOffset += direction;
			}
			// Check if the relative content offset is in the opposite direction we are trying to go
			if (
				relativeContentOffset === offset ||
				( relativeContentOffset - offset < 0 ? -1 : 1 ) !== direction
			) {
				return relativeStructuralOffset;
			}
			// There's a slug nearby, go into it if it's closer
			return direction > 0 ?
				Math.min( relativeContentOffset, relativeStructuralOffset ) :
				Math.max( relativeContentOffset, relativeStructuralOffset );
		} else {
			// Don't allow the offset to move in the wrong direction
			return direction > 0 ?
				Math.max( relativeContentOffset, offset ) :
				Math.min( relativeContentOffset, offset );
		}
	}
};

/**
 * Get the relative range.
 *
 * @method
 * @param {ve.Range} range Input range
 * @param {number} direction Direction to look in, +1 or -1
 * @param {string} unit Unit [word|character]
 * @param {boolean} expand Expanding range
 * @param {ve.Range} [limit] Optional limiting range. If the relative range is not in this range
 *                           the input range is returned instead.
 * @return {ve.Range} Relative range
 */
ve.dm.Document.prototype.getRelativeRange = function ( range, direction, unit, expand, limit ) {
	var contentOrSlugOffset,
		focusableNode,
		newOffset,
		newRange,
		to = range.to;

	// If you have a non-collapsed range and you move, collapse to the end
	// in the direction you moved, provided you end up at a content or slug offset
	if ( !range.isCollapsed() && !expand ) {
		newOffset = direction > 0 ? range.end : range.start;
		if ( this.data.isContentOffset( newOffset ) || this.hasSlugAtOffset( newOffset ) ) {
			return new ve.Range( newOffset );
		} else {
			to = newOffset;
		}
	}

	contentOrSlugOffset = this.getRelativeOffset( to, direction, unit );

	focusableNode = this.getNearestFocusableNode( to, direction, contentOrSlugOffset );
	if ( focusableNode ) {
		newRange = focusableNode.getOuterRange( direction === -1 );
	} else {
		newRange = new ve.Range( contentOrSlugOffset );
	}
	if ( limit && !limit.containsRange( newRange ) ) {
		return range;
	}
	if ( expand ) {
		return new ve.Range( range.from, newRange.to );
	} else {
		return newRange;
	}
};

/**
 * Get the nearest focusable node.
 *
 * @method
 * @param {number} offset Offset to start looking at
 * @param {number} direction Direction to look in, +1 or -1
 * @param {number} limit Stop looking after reaching certain offset
 * @return {ve.dm.Node|null} Nearest focusable node, or null if not found
 */
ve.dm.Document.prototype.getNearestFocusableNode = function ( offset, direction, limit ) {
	// It is never an offset of the node, but just an offset for which getNodeFromOffset should
	// return that node. Usually it would be node offset + 1 or offset of node closing tag.
	var coveredOffset;
	this.data.getRelativeOffset(
		offset,
		direction === 1 ? 0 : -1,
		function ( index, limit ) {
			// Our result must be between offset and limit
			if ( index >= Math.max( offset, limit ) || index < Math.min( offset, limit ) ) {
				return true;
			}
			if (
				this.isOpenElementData( index ) &&
				ve.dm.nodeFactory.isNodeFocusable( this.getType( index ) )
			) {
				coveredOffset = index + 1;
				return true;
			}
			if (
				this.isCloseElementData( index ) &&
				ve.dm.nodeFactory.isNodeFocusable( this.getType( index ) )
			) {
				coveredOffset = index;
				return true;
			}
		},
		limit
	);
	if ( coveredOffset ) {
		return this.getDocumentNode().getNodeFromOffset( coveredOffset );
	} else {
		return null;
	}
};

/**
 * Get the nearest offset that a cursor can be placed at.
 *
 * @method
 * @param {number} offset Offset to start looking at
 * @param {number} [direction=-1] Direction to look in, +1 or -1
 * @return {number} Nearest offset a cursor can be placed at
 */
ve.dm.Document.prototype.getNearestCursorOffset = function ( offset, direction ) {
	var contentOffset, structuralOffset;

	direction = direction > 0 ? 1 : -1;
	if (
		this.data.isContentOffset( offset ) ||
		this.hasSlugAtOffset( offset )
	) {
		return offset;
	}

	contentOffset = this.data.getNearestContentOffset( offset, direction );
	structuralOffset = this.data.getNearestStructuralOffset( offset, direction, true );

	if ( !this.hasSlugAtOffset( structuralOffset ) && contentOffset !== -1 ) {
		return contentOffset;
	}

	if ( direction === 1 ) {
		if ( contentOffset < offset ) {
			return structuralOffset;
		} else {
			return Math.min( contentOffset, structuralOffset );
		}
	} else {
		if ( contentOffset > offset ) {
			return structuralOffset;
		} else {
			return Math.max( contentOffset, structuralOffset );
		}
	}
};

/**
 * @inheritdoc
 */
ve.dm.Document.prototype.getBranchNodeFromOffset = function ( offset ) {
	if ( offset < 0 || offset > this.data.getLength() ) {
		throw new Error( 've.dm.Document.getBranchNodeFromOffset(): offset ' + offset + ' is out of bounds' );
	}
	return ve.Document.prototype.getBranchNodeFromOffset.call( this, offset );
};

/**
 * Check if there is a slug at an offset.
 *
 * @method
 * @param {number} offset Offset to check for a slug at
 * @return {boolean} There is a slug at the offset
 */
ve.dm.Document.prototype.hasSlugAtOffset = function ( offset ) {
	var node = this.getBranchNodeFromOffset( offset );
	return node ? node.hasSlugAtOffset( offset ) : false;
};

/**
 * Get the content data of a node.
 *
 * @method
 * @param {ve.dm.Node} node Node to get content data for
 * @return {Array|null} List of content and elements inside node or null if node is not found
 */
ve.dm.Document.prototype.getDataFromNode = function ( node ) {
	var length = node.getLength(),
		offset = node.getOffset();
	if ( offset >= 0 ) {
		// FIXME T126023: If the node is wrapped in an element than we should increment
		// the offset by one so we only return the content inside the element.
		if ( node.isWrapped() ) {
			offset++;
		}
		return this.data.slice( offset, offset + length );
	}
	return null;
};

/**
 * Rebuild one or more nodes following a change in document data.
 *
 * The data provided to this method may contain either one node or multiple sibling nodes, but it
 * must be balanced and valid. Data provided to this method also may not contain any content at the
 * top level. The tree is updated during this operation.
 *
 * Process:
 *
 *  1. Nodes between {index} and {index} + {numNodes} in {parent} will be removed
 *  2. Data will be retrieved from this.data using {offset} and {newLength}
 *  3. A document fragment will be generated from the retrieved data
 *  4. The document fragment's nodes will be inserted into {parent} at {index}
 *
 * Use cases:
 *
 *  1. Rebuild old nodes and offset data after a change to the linear model.
 *  2. Insert new nodes and offset data after a insertion in the linear model.
 *
 * @param {ve.dm.Node} parent Parent of the node(s) being rebuilt
 * @param {number} index Index within parent to rebuild or insert nodes
 *
 *  - If {numNodes} == 0: Index to insert nodes at
 *  - If {numNodes} >= 1: Index of first node to rebuild
 * @param {number} numNodes Total number of nodes to rebuild
 *
 *  - If {numNodes} == 0: Nothing will be rebuilt, but the node(s) built from data will be
 *    inserted before {index}. To insert nodes at the end, use number of children in 'parent'
 *  - If {numNodes} == 1: Only the node at {index} will be rebuilt
 *  - If {numNodes} > 1: The node at {index} and the next {numNodes-1} nodes will be rebuilt
 * @param {number} offset Linear model offset to rebuild from
 * @param {number} newLength Length of data in linear model to rebuild or insert nodes for
 * @return {ve.dm.Node[]} Array containing the rebuilt/inserted nodes
 */
ve.dm.Document.prototype.rebuildNodes = function ( parent, index, numNodes, offset, newLength ) {
	// Get a slice of the document where it's been changed
	var data = this.data.sliceObject( offset, offset + newLength ),
		// Build document fragment from data
		fragment = new this.constructor( data, this.htmlDocument, this ),
		// Get generated child nodes from the document fragment
		addedNodes = fragment.getDocumentNode().getChildren(),
		// Replace nodes in the model tree
		removedNodes = ve.batchSplice( parent, index, numNodes, addedNodes );

	this.updateNodesByType( addedNodes, removedNodes );

	// Return inserted nodes
	return addedNodes;
};

/**
 * Rebuild the entire node tree from linear model data.
 */
ve.dm.Document.prototype.rebuildTree = function () {
	var documentNode = this.getDocumentNode();
	this.rebuildNodes(
		documentNode,
		0,
		documentNode.getChildren().length,
		0,
		this.data.getLength()
	);
};

/**
 * Update the nodes-by-type index
 *
 * @param {ve.dm.Node[]} addedNodes Added nodes
 * @param {ve.dm.Node[]} removedNodes Removed nodes
 */
ve.dm.Document.prototype.updateNodesByType = function ( addedNodes, removedNodes ) {
	var doc = this;

	function remove( node ) {
		var type = node.getType(),
			nodes = doc.nodesByType[ type ] || [],
			index = nodes.indexOf( node );

		if ( index !== -1 ) {
			nodes.splice( index, 1 );
			if ( !nodes.length ) {
				delete doc.nodesByType[ type ];
			}
		}
	}

	function add( node ) {
		var type = node.getType(),
			nodes = doc.nodesByType[ type ] = doc.nodesByType[ type ] || [];

		nodes.push( node );
	}

	function traverse( nodes, action ) {
		nodes.forEach( function ( node ) {
			if ( node.hasChildren() ) {
				node.traverse( action );
			}
			action( node );
		} );
	}

	traverse( removedNodes, remove );
	traverse( addedNodes, add );
};

/**
 * Get all nodes in the tree for a specific type
 *
 * If a string type is passed only nodes of that exact type will be returned,
 * if a node class is passed, all sub types will be matched.
 *
 * String type matching will be faster than class matching.
 *
 * @param {string|Function} type Node type name or node constructor
 * @param {boolean} sort Sort nodes by document order
 * @return {ve.dm.Node[]} Nodes of a specific type
 */
ve.dm.Document.prototype.getNodesByType = function ( type, sort ) {
	var t, nodeType,
		nodes = [];
	if ( type instanceof Function ) {
		for ( t in this.nodesByType ) {
			nodeType = ve.dm.nodeFactory.lookup( t );
			if ( nodeType === type || nodeType.prototype instanceof type ) {
				nodes = nodes.concat( this.getNodesByType( t ) );
			}
		}
	} else {
		nodes = this.nodesByType[ type ] || [];
	}

	if ( sort ) {
		nodes.sort( function ( a, b ) {
			return a.getOffset() - b.getOffset();
		} );
	}
	return nodes;
};

/**
 * Fix up data so it can safely be inserted into the document data at an offset.
 *
 * TODO: this function needs more work but it seems to work, mostly
 *
 * @method
 * @param {Array} data Snippet of linear model data to insert
 * @param {number} offset Offset in the linear model where the caller wants to insert data
 * @return {Object} A (possibly modified) copy of data, a (possibly modified) offset,
 * and a number of elements to remove and the position of the original data in the new data
 */
ve.dm.Document.prototype.fixupInsertion = function ( data, offset ) {
	var
		// Array where we build the return value
		newData = [],

		// Temporary variables for handling combining marks
		insert, annotations,
		// An unattached combining mark may require the insertion to remove a character,
		// so we send this counter back in the result
		remove = 0,

		// *** Stacks ***
		// Array of element openings (object). Openings in data are pushed onto this stack
		// when they are encountered and popped off when they are closed
		openingStack = [],
		// Array of node objects. Closings in data that close nodes that were
		// not opened in data (i.e. were already in the document) are pushed onto this stack
		// and popped off when balanced out by an opening in data
		closingStack = [],

		// Track the position of the original data in the fixed up data for range adjustments
		insertedDataOffset = 0,
		insertedDataLength = data.length,

		// Pointer to this document for private methods
		doc = this,

		// *** State persisting across iterations of the outer loop ***
		// The node (from the document) we're currently in. When in a node that was opened
		// in data, this is set to its first ancestor that is already in the document
		parentNode,
		// The type of the node we're currently in, even if that node was opened within data
		parentType,
		// Whether we are currently in a text node
		inTextNode,
		// Whether this is the first child of its parent
		// The test for last child isn't a loop so we don't need to cache it
		isFirstChild,

		// *** Temporary variables that do not persist across iterations ***
		// The type of the node we're currently inserting. When the to-be-inserted node
		// is wrapped, this is set to the type of the outer wrapper.
		childType,
		// Stores the return value of getParentNodeTypes( childType )
		allowedParents,
		// Stores the return value of getChildNodeTypes( parentType )
		allowedChildren,
		// Whether parentType matches allowedParents
		parentsOK,
		// Whether childType matches allowedChildren
		childrenOK,
		// Array of opening elements to insert (for wrapping the to-be-inserted element)
		openings,
		// Array of closing elements to insert (for splitting nodes)
		closings,
		// Array of opening elements matching the elements in closings (in the same order)
		reopenElements,

		// *** Other variables ***
		// Used to store values popped from various stacks
		popped,
		// Loop variables
		i, j;

	/**
	 * Append a linear model element to newData and update the state.
	 *
	 * This function updates parentNode, parentType, openingStack and closingStack.
	 *
	 * @private
	 * @method
	 * @param {Object|Array|string} element Linear model element
	 * @param {number} index Index in data that the element came from (for error reporting only)
	 */
	function writeElement( element, index ) {
		var expectedType;

		if ( element.type !== undefined ) {
			// Content, do nothing
			if ( element.type.charAt( 0 ) !== '/' ) {
				// Opening
				// Check if this opening balances an earlier closing of a node that was already in
				// the document. This is only the case if openingStack is empty (otherwise we still
				// have unclosed nodes from within data) and if this opening matches the top of
				// closingStack
				if ( openingStack.length === 0 && closingStack.length > 0 &&
					closingStack[ closingStack.length - 1 ].getType() === element.type
				) {
					// The top of closingStack is now balanced out, so remove it
					// Also restore parentNode from closingStack. While this is technically not
					// entirely accurate (the current node is a new node that's a sibling of this
					// node), it's good enough for the purposes of this algorithm
					parentNode = closingStack.pop();
				} else {
					// This opens something new, put it on openingStack
					openingStack.push( element );
				}
				parentType = element.type;
			} else {
				// Closing
				// Make sure that this closing matches the currently opened node
				if ( openingStack.length > 0 ) {
					// The opening was on openingStack, so we're closing a node that was opened
					// within data. Don't track that on closingStack
					expectedType = openingStack.pop().type;
				} else {
					// openingStack is empty, so we're closing a node that was already in the
					// document. This means we have to reopen it later, so track this on
					// closingStack
					expectedType = parentNode.getType();
					closingStack.push( parentNode );
					parentNode = parentNode.getParent();
					if ( !parentNode ) {
						throw new Error( 'Inserted data is trying to close the root node ' +
							'(at index ' + index + ')' );
					}
					parentType = expectedType;

					// Validate
					// FIXME this breaks certain input, should fix it up, not scream and die
					// For now we fall back to inserting balanced data, but then we miss out on
					// a lot of the nice content adoption abilities of just fixing up the data in
					// the context of the insertion point - an example of how this will fail is if
					// you try to insert "b</p></li></ul><p>c" into "<p>a[cursor]d</p>"
					if (
						element.type !== '/' + expectedType &&
						(
							// Only throw an error if the content can't be adopted from one content
							// branch to another
							!ve.dm.nodeFactory.canNodeContainContent( element.type.slice( 1 ) ) ||
							!ve.dm.nodeFactory.canNodeContainContent( expectedType )
						)
					) {
						throw new Error( 'Cannot adopt content from ' + element.type +
							' nodes into ' + expectedType + ' nodes (at index ' + index + ')' );
					}
				}
			}
		}
		newData.push( element );
	}

	parentNode = this.getBranchNodeFromOffset( offset );
	parentType = parentNode.getType();
	inTextNode = false;
	isFirstChild = doc.data.isOpenElementData( offset - 1 );

	for ( i = 0; i < data.length; i++ ) {
		if ( inTextNode && data[ i ].type !== undefined ) {
			parentType = openingStack.length > 0 ?
				openingStack[ openingStack.length - 1 ].type : parentNode.getType();
		}
		if ( data[ i ].type === undefined || data[ i ].type.charAt( 0 ) !== '/' ) {
			childType = data[ i ].type || 'text';
			openings = [];
			closings = [];
			reopenElements = [];
			// Opening or content
			// Make sure that opening this element here does not violate the parent/children/content
			// rules. If it does, insert stuff to fix it

			// If this node is content, check that the containing node can contain content. If not,
			// wrap in a paragraph
			if ( ve.dm.nodeFactory.isNodeContent( childType ) &&
				!ve.dm.nodeFactory.canNodeContainContent( parentType )
			) {
				childType = 'paragraph';
				openings.unshift( ve.dm.nodeFactory.getDataElement( childType ) );
			}

			// Check that this node is allowed to have the containing node as its parent. If not,
			// wrap it until it's fixed
			do {
				allowedParents = ve.dm.nodeFactory.getParentNodeTypes( childType );
				parentsOK = allowedParents === null ||
					allowedParents.indexOf( parentType ) !== -1;
				if ( !parentsOK ) {
					// We can't have this as the parent
					if ( allowedParents.length === 0 ) {
						throw new Error( 'Cannot insert ' + childType + ' because it ' +
							' cannot have a parent (at index ' + i + ')' );
					}
					// Open an allowed node around this node
					childType = allowedParents[ 0 ];
					openings.unshift( ve.dm.nodeFactory.getDataElement( childType ) );
				}
			} while ( !parentsOK );

			// Check that the containing node can have this node as its child. If not, close nodes
			// until it's fixed
			do {
				allowedChildren = ve.dm.nodeFactory.getChildNodeTypes( parentType );
				childrenOK = allowedChildren === null ||
					allowedChildren.indexOf( childType ) !== -1;
				// Also check if we're trying to insert structure into a node that has to contain
				// content
				childrenOK = childrenOK && !(
					!ve.dm.nodeFactory.isNodeContent( childType ) &&
					ve.dm.nodeFactory.canNodeContainContent( parentType )
				);
				if ( !childrenOK ) {
					// We can't insert this into this parent
					if ( isFirstChild ) {
						// This element is the first child of its parent, so
						// abandon this fix up and try again one offset to the left
						return this.fixupInsertion( data, offset - 1 );
					}

					// Close the parent and try one level up
					closings.push( { type: '/' + parentType } );
					if ( openingStack.length > 0 ) {
						popped = openingStack.pop();
						parentType = popped.type;
						reopenElements.push( ve.copy( popped ) );
						// The opening was on openingStack, so we're closing a node that was opened
						// within data. Don't track that on closingStack
					} else {
						if ( !parentNode.getParent() ) {
							throw new Error( 'Cannot insert ' + childType + ' even after closing ' +
								'all containing nodes (at index ' + i + ')' );
						}
						// openingStack is empty, so we're closing a node that was already in the
						// document. This means we have to reopen it later, so track this on
						// closingStack
						closingStack.push( parentNode );
						reopenElements.push( parentNode.getClonedElement() );
						parentNode = parentNode.getParent();
						parentType = parentNode.getType();
					}
				}
			} while ( !childrenOK );

			if (
				i === 0 &&
				childType === 'text' &&
				ve.isUnattachedCombiningMark( data[ i ] )
			) {
				// Note we only need to check data[0] as combining marks further
				// along should already have been merged
				if ( doc.data.isElementData( offset - 1 ) ) {
					// Inserting a unattached combining mark is generally pretty badly
					// supported (browser rendering bugs), so we'll just prevent it.
					continue;
				} else {
					offset--;
					remove++;
					insert = doc.data.getCharacterData( offset ) + data[ i ];
					annotations = doc.data.getAnnotationIndexesFromOffset( offset );
					if ( annotations.length ) {
						insert = [ insert, annotations ];
					}
					data[ i ] = insert;
				}
			}

			for ( j = 0; j < closings.length; j++ ) {
				// writeElement() would update openingStack/closingStack, but we've already done
				// that for closings
				if ( i === 0 ) {
					insertedDataOffset++;
				} else {
					insertedDataLength++;
				}
				newData.push( closings[ j ] );
			}
			for ( j = 0; j < openings.length; j++ ) {
				if ( i === 0 ) {
					insertedDataOffset++;
				} else {
					insertedDataLength++;
				}
				writeElement( openings[ j ], i );
			}
			writeElement( data[ i ], i );
			if ( data[ i ].type === undefined ) {
				// Special treatment for text nodes
				inTextNode = true;
				if ( openings.length > 0 ) {
					// We wrapped the text node, update parentType
					parentType = childType;
				}
				// If we didn't wrap the text node, then the node we're inserting into can have
				// content, so we couldn't have closed anything
			} else {
				parentType = data[ i ].type;
			}
		} else {
			// Closing
			writeElement( data[ i ], i );
			parentType = openingStack.length > 0 ?
				openingStack[ openingStack.length - 1 ].type : parentNode.getType();
		}
	}

	if ( closingStack.length > 0 && doc.data.isCloseElementData( offset ) ) {
		// This element is the last child of its parent, so
		// abandon this fix up and try again one offset to the right
		return this.fixupInsertion( data, offset + 1 );
	}

	if ( inTextNode ) {
		parentType = openingStack.length > 0 ?
			openingStack[ openingStack.length - 1 ].type : parentNode.getType();
	}

	// Close unclosed openings
	while ( openingStack.length > 0 ) {
		popped = openingStack[ openingStack.length - 1 ];
		// writeElement() will perform the actual pop() that removes
		// popped from openingStack
		writeElement( { type: '/' + popped.type }, i );
	}
	// Re-open closed nodes
	while ( closingStack.length > 0 ) {
		popped = closingStack[ closingStack.length - 1 ];
		// writeElement() will perform the actual pop() that removes
		// popped from closingStack
		writeElement( popped.getClonedElement(), i );
	}

	return {
		offset: offset,
		data: newData,
		remove: remove,
		insertedDataOffset: insertedDataOffset,
		insertedDataLength: insertedDataLength
	};
};

/**
 * Create a document given an HTML string or document.
 *
 * @method
 * @param {string|HTMLDocument} html HTML string or document to insert
 * @param {Object} [importRules] The import rules with which to sanitize the HTML, if importing
 * @return {ve.dm.Document} New document
 */
ve.dm.Document.prototype.newFromHtml = function ( html, importRules ) {
	var htmlDoc = typeof html === 'string' ? ve.createDocumentFromHtml( html ) : html,
		doc = ve.dm.converter.getModelFromDom( htmlDoc, {
			targetDoc: this.getHtmlDocument(),
			fromClipboard: !!importRules
		} ),
		data = doc.data;

	// FIXME T126020: This is a paste-specific thing and possibly should not be in the generic
	// newFromHtml() function. Maybe make this be triggered by a pasteRules property?
	// Clear metadata
	doc.metadata = new ve.dm.MetaLinearData( doc.getStore(), new Array( 1 + data.getLength() ) );

	if ( importRules ) {
		data.sanitize( importRules.external || {} );
		data.sanitize( importRules.all || {} );
	}

	data.remapInternalListKeys( this.getInternalList() );
	// Initialize node tree
	// BUG T75569: This shouldn't be needed
	doc.buildNodeTree();

	return doc;
};

/**
 * Find a text string within the document
 *
 * @param {string|RegExp} query Text to find, string or regex with no flags
 * @param {Object} [options] Search options
 * @param {boolean} [options.caseSensitiveString] Case sensitive search for a string query. Ignored by regexes (use 'i' flag).
 * @param {boolean} [options.diacriticInsensitiveString] Diacritic insensitive search for a string query. Ignored by regexes.
 *  Only works in browsers which support the Internationalization API
 * @param {boolean} [options.noOverlaps] Avoid overlapping matches
 * @param {boolean} [options.wholeWord] Only match whole-word occurrences
 * @return {ve.Range[]} List of ranges where the string was found
 */
ve.dm.Document.prototype.findText = function ( query, options ) {
	var i, j, l, qLen, match, offset, lines, dataString, sensitivity, compare, text,
		data = this.data,
		docLen = this.getInternalList().getListNode().getOuterRange().start,
		ranges = [];

	options = options || {};

	if ( query instanceof RegExp ) {
		// Convert whole doucment to plain-text for regex matching
		text = data.getText(
			true,
			new ve.Range( 0, docLen )
		);
		offset = 0;
		// Avoid multi-line matching by only matching within newlines
		lines = text.split( '\n' );
		for ( i = 0, l = lines.length; i < l; i++ ) {
			while ( lines[ i ] && ( match = query.exec( lines[ i ] ) ) !== null ) {
				// Skip empty string matches (e.g. with .*)
				if ( match[ 0 ].length === 0 ) {
					// Set lastIndex to the next character to avoid an infinite
					// loop. Browsers differ in whether they do this for you
					// for empty matches; see
					// http://blog.stevenlevithan.com/archives/exec-bugs
					query.lastIndex = match.index + 1;
					continue;
				}
				ranges.push( new ve.Range(
					offset + match.index,
					offset + match.index + match[ 0 ].length
				) );
				if ( !options.noOverlaps ) {
					query.lastIndex = match.index + 1;
				}
			}
			offset += lines[ i ].length + 1;
			query.lastIndex = 0;
		}
	} else {
		qLen = query.length;
		if ( ve.supportsIntl ) {
			if ( options.diacriticInsensitiveString ) {
				sensitivity = options.caseSensitiveString ? 'case' : 'base';
			} else {
				sensitivity = options.caseSensitiveString ? 'variant' : 'accent';
			}
			compare = new Intl.Collator( this.lang, { sensitivity: sensitivity } ).compare;
		} else {
			// Support: IE<=10
			compare = options.caseSensitiveString ?
				function ( a, b ) {
					return a === b ? 0 : 1;
				} :
				function ( a, b ) {
					return a.toLowerCase() === b.toLowerCase() ? 0 : 1;
				};
		}
		// Iterate up to (and including) offset textLength - queryLength. Beyond that point
		// there is not enough room for the query to exist
		for ( offset = 0, l = docLen - qLen; offset <= l; offset++ ) {
			j = 0;
			while ( compare( data.getCharacterData( offset + j ), query[ j ] ) === 0 ) {
				j++;
				if ( j === qLen ) {
					ranges.push( new ve.Range( offset, offset + qLen ) );
					offset += options.noOverlaps ? qLen - 1 : 0;
					break;
				}
			}
		}
	}

	if ( options.wholeWord ) {
		dataString = new ve.dm.DataString( this.getData() );
		ranges = ranges.filter( function ( range ) {
			return unicodeJS.wordbreak.isBreak( dataString, range.start ) &&
				unicodeJS.wordbreak.isBreak( dataString, range.end );
		} );
	}

	return ranges;
};

/**
 * Get the length of the complete history stack. This is also the current pointer.
 *
 * @return {number} Length of the complete history stack
 */
ve.dm.Document.prototype.getCompleteHistoryLength = function () {
	return this.completeHistory.length;
};

/**
 * Get all the items in the complete history stack since a specified pointer.
 *
 * @param {number} start Pointer from where to start the slice
 * @return {ve.dm.Transaction[]} Array of transaction objects with undo flag
 */
ve.dm.Document.prototype.getCompleteHistorySince = function ( start ) {
	return this.completeHistory.slice( start );
};

/**
 * Single change containing most recent transactions in history stack
 *
 * @param {number} start Pointer from where to start slicing transactions
 * @return {ve.dm.Change} Single change containing transactions since pointer
 */
ve.dm.Document.prototype.getChangeSince = function ( start ) {
	var t, len, transaction,
		transactions = [],
		stores = [];
	for ( t = start, len = this.completeHistory.length; t < len; t++ ) {
		transaction = this.completeHistory[ t ];
		transactions.push( transaction );
		stores.push( this.store.slice(
			this.storeLengthAtHistoryLength[ t ],
			this.storeLengthAtHistoryLength[ t + 1 ]
		) );
	}
	return new ve.dm.Change( start, transactions, stores, {} );
};

/**
 * Get the content language
 *
 * @return {string} Language code
 */
ve.dm.Document.prototype.getLang = function () {
	return this.lang;
};

/**
 * Get the content directionality
 *
 * @return {string} Directionality (ltr/rtl)
 */
ve.dm.Document.prototype.getDir = function () {
	return this.dir;
};
