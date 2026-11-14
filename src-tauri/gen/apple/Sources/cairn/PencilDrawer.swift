import UIKit
import PencilKit

private final class PaperGridView: UIView {
	var showGrid: Bool = true {
		didSet { setNeedsDisplay() }
	}

	override init(frame: CGRect) {
		super.init(frame: frame)
		backgroundColor = .white
		contentMode = .redraw
	}

	required init?(coder: NSCoder) {
		fatalError("init(coder:) has not been implemented")
	}

	override func draw(_ rect: CGRect) {
		UIColor.white.setFill()
		UIRectFill(rect)
		guard showGrid else { return }

		let spacing: CGFloat = 24
		let dotRadius: CGFloat = 1.0
		UIColor(white: 0.82, alpha: 1.0).setFill()

		let startX = floor(rect.minX / spacing) * spacing
		let startY = floor(rect.minY / spacing) * spacing
		var y = startY
		while y <= rect.maxY {
			var x = startX
			while x <= rect.maxX {
				let dotRect = CGRect(x: x - dotRadius, y: y - dotRadius, width: dotRadius * 2, height: dotRadius * 2)
				UIBezierPath(ovalIn: dotRect).fill()
				x += spacing
			}
			y += spacing
		}
	}
}

private struct PencilDrawerResultPayload: Encodable {
	let cancelled: Bool
	let pngBase64: String?
	let drawingDataB64: String?
	let heightRatio: Double
}

private final class PencilDrawerViewController: UIViewController, PKCanvasViewDelegate, PKToolPickerObserver {
	private let initialDrawingData: Data?
	private var heightRatio: CGFloat
	private let onHeightChange: (CGFloat) -> Void
	private let onComplete: (PencilDrawerResultPayload) -> Void

	private var heightConstraint: NSLayoutConstraint?
	private var panStartHeight: CGFloat = 0
	private var hasFinished = false

	private let headerBar = UIView()
	private let grabberPill = UIView()
	private let canvasContainer = UIView()
	private let paperView = PaperGridView()
	private let canvasView = PKCanvasView()
	private var toolPicker: PKToolPicker?

	private lazy var undoButton = makeIconButton(systemName: "arrow.uturn.backward", action: #selector(handleUndo))
	private lazy var redoButton = makeIconButton(systemName: "arrow.uturn.forward", action: #selector(handleRedo))
	private lazy var clearButton = makeIconButton(systemName: "trash", action: #selector(handleClear))
	private lazy var gridButton = makeIconButton(systemName: "grid", action: #selector(handleToggleGrid))
	private lazy var cancelButton: UIButton = {
		var config = UIButton.Configuration.plain()
		config.title = "Close"
		config.contentInsets = NSDirectionalEdgeInsets(top: 6, leading: 10, bottom: 6, trailing: 10)
		let btn = UIButton(configuration: config)
		btn.addTarget(self, action: #selector(handleCancel), for: .touchUpInside)
		return btn
	}()
	private lazy var attachButton: UIButton = {
		var config = UIButton.Configuration.filled()
		config.title = "Attach"
		config.cornerStyle = .capsule
		config.contentInsets = NSDirectionalEdgeInsets(top: 6, leading: 14, bottom: 6, trailing: 14)
		let btn = UIButton(configuration: config)
		btn.addTarget(self, action: #selector(handleAttach), for: .touchUpInside)
		return btn
	}()

	init(
		initialDrawingData: Data?,
		heightRatio: CGFloat,
		onHeightChange: @escaping (CGFloat) -> Void,
		onComplete: @escaping (PencilDrawerResultPayload) -> Void
	) {
		self.initialDrawingData = initialDrawingData
		self.heightRatio = min(max(heightRatio, 0.40), 0.60)
		self.onHeightChange = onHeightChange
		self.onComplete = onComplete
		super.init(nibName: nil, bundle: nil)
	}

	required init?(coder: NSCoder) {
		fatalError("init(coder:) has not been implemented")
	}

	override func viewDidLoad() {
		super.viewDidLoad()
		setupUI()
		loadInitialDrawing()
	}

	override func viewDidAppear(_ animated: Bool) {
		super.viewDidAppear(animated)
		setupToolPicker()
		updateCanvasContentSize()
		notifyCurrentHeight()
	}

	override func viewDidLayoutSubviews() {
		super.viewDidLayoutSubviews()
		updateCanvasContentSize()
	}

	func attachToParent(_ parentVC: UIViewController) {
		parentVC.addChild(self)
		view.translatesAutoresizingMaskIntoConstraints = false
		parentVC.view.addSubview(view)

		let initialHeight = clampedHeight(forRatio: heightRatio, in: parentVC.view.bounds.height)
		let hConstraint = view.heightAnchor.constraint(equalToConstant: initialHeight)
		self.heightConstraint = hConstraint

		NSLayoutConstraint.activate([
			view.leadingAnchor.constraint(equalTo: parentVC.view.leadingAnchor),
			view.trailingAnchor.constraint(equalTo: parentVC.view.trailingAnchor),
			view.bottomAnchor.constraint(equalTo: parentVC.view.bottomAnchor),
			hConstraint,
		])

		view.transform = CGAffineTransform(translationX: 0, y: initialHeight)
		UIView.animate(withDuration: 0.25, delay: 0, options: [.curveEaseOut]) {
			self.view.transform = .identity
		} completion: { _ in
			self.didMove(toParent: parentVC)
			self.notifyCurrentHeight()
		}
	}

	func dismissDrawer(cancelled: Bool) {
		guard !hasFinished else { return }
		hasFinished = true

		toolPicker?.setVisible(false, forFirstResponder: canvasView)
		toolPicker?.removeObserver(self)
		canvasView.resignFirstResponder()

		let drawingB64 = encodedDrawingData()
		let pngB64 = cancelled ? nil : renderPNG()
		let ratio = Double(heightRatio)

		let height = view.bounds.height
		UIView.animate(withDuration: 0.22, delay: 0, options: [.curveEaseIn]) {
			self.view.transform = CGAffineTransform(translationX: 0, y: max(height, 300))
		} completion: { _ in
			self.willMove(toParent: nil)
			self.view.removeFromSuperview()
			self.removeFromParent()
			self.onHeightChange(0)
			self.onComplete(PencilDrawerResultPayload(
				cancelled: cancelled,
				pngBase64: pngB64,
				drawingDataB64: drawingB64,
				heightRatio: ratio
			))
		}
	}

	private func setupUI() {
		view.backgroundColor = .secondarySystemBackground
		view.layer.cornerRadius = 16
		view.layer.maskedCorners = [.layerMinXMinYCorner, .layerMaxXMinYCorner]
		view.layer.shadowColor = UIColor.black.cgColor
		view.layer.shadowOpacity = 0.16
		view.layer.shadowRadius = 12
		view.layer.shadowOffset = CGSize(width: 0, height: -3)

		headerBar.translatesAutoresizingMaskIntoConstraints = false
		headerBar.backgroundColor = .secondarySystemBackground
		headerBar.layer.cornerRadius = 16
		headerBar.layer.maskedCorners = [.layerMinXMinYCorner, .layerMaxXMinYCorner]
		view.addSubview(headerBar)

		grabberPill.translatesAutoresizingMaskIntoConstraints = false
		grabberPill.backgroundColor = .tertiaryLabel
		grabberPill.layer.cornerRadius = 2.5
		headerBar.addSubview(grabberPill)

		let pan = UIPanGestureRecognizer(target: self, action: #selector(handleGrabberPan(_:)))
		headerBar.addGestureRecognizer(pan)

		let leftStack = UIStackView(arrangedSubviews: [undoButton, redoButton, clearButton, gridButton])
		leftStack.axis = .horizontal
		leftStack.spacing = 4
		leftStack.translatesAutoresizingMaskIntoConstraints = false

		let rightStack = UIStackView(arrangedSubviews: [cancelButton, attachButton])
		rightStack.axis = .horizontal
		rightStack.spacing = 6
		rightStack.translatesAutoresizingMaskIntoConstraints = false

		headerBar.addSubview(leftStack)
		headerBar.addSubview(rightStack)

		let divider = UIView()
		divider.translatesAutoresizingMaskIntoConstraints = false
		divider.backgroundColor = .separator
		view.addSubview(divider)

		canvasContainer.translatesAutoresizingMaskIntoConstraints = false
		canvasContainer.backgroundColor = .white
		canvasContainer.clipsToBounds = true
		view.addSubview(canvasContainer)

		paperView.translatesAutoresizingMaskIntoConstraints = false
		canvasContainer.addSubview(paperView)

		canvasView.translatesAutoresizingMaskIntoConstraints = false
		canvasView.delegate = self
		canvasView.drawingPolicy = .pencilOnly
		canvasView.isOpaque = false
		canvasView.backgroundColor = .clear
		canvasView.alwaysBounceVertical = true
		canvasContainer.addSubview(canvasView)

		NSLayoutConstraint.activate([
			headerBar.topAnchor.constraint(equalTo: view.topAnchor),
			headerBar.leadingAnchor.constraint(equalTo: view.leadingAnchor),
			headerBar.trailingAnchor.constraint(equalTo: view.trailingAnchor),
			headerBar.heightAnchor.constraint(equalToConstant: 52),

			grabberPill.topAnchor.constraint(equalTo: headerBar.topAnchor, constant: 6),
			grabberPill.centerXAnchor.constraint(equalTo: headerBar.centerXAnchor),
			grabberPill.widthAnchor.constraint(equalToConstant: 40),
			grabberPill.heightAnchor.constraint(equalToConstant: 5),

			leftStack.leadingAnchor.constraint(equalTo: headerBar.leadingAnchor, constant: 12),
			leftStack.bottomAnchor.constraint(equalTo: headerBar.bottomAnchor, constant: -6),

			rightStack.trailingAnchor.constraint(equalTo: headerBar.trailingAnchor, constant: -12),
			rightStack.bottomAnchor.constraint(equalTo: headerBar.bottomAnchor, constant: -6),

			divider.topAnchor.constraint(equalTo: headerBar.bottomAnchor),
			divider.leadingAnchor.constraint(equalTo: view.leadingAnchor),
			divider.trailingAnchor.constraint(equalTo: view.trailingAnchor),
			divider.heightAnchor.constraint(equalToConstant: 1.0 / UIScreen.main.scale),

			canvasContainer.topAnchor.constraint(equalTo: divider.bottomAnchor),
			canvasContainer.leadingAnchor.constraint(equalTo: view.leadingAnchor),
			canvasContainer.trailingAnchor.constraint(equalTo: view.trailingAnchor),
			canvasContainer.bottomAnchor.constraint(equalTo: view.bottomAnchor),

			paperView.topAnchor.constraint(equalTo: canvasContainer.topAnchor),
			paperView.leadingAnchor.constraint(equalTo: canvasContainer.leadingAnchor),
			paperView.trailingAnchor.constraint(equalTo: canvasContainer.trailingAnchor),
			paperView.bottomAnchor.constraint(equalTo: canvasContainer.bottomAnchor),

			canvasView.topAnchor.constraint(equalTo: canvasContainer.topAnchor),
			canvasView.leadingAnchor.constraint(equalTo: canvasContainer.leadingAnchor),
			canvasView.trailingAnchor.constraint(equalTo: canvasContainer.trailingAnchor),
			canvasView.bottomAnchor.constraint(equalTo: canvasContainer.bottomAnchor),
		])

		updateUndoRedoState()
	}

	private func makeIconButton(systemName: String, action: Selector) -> UIButton {
		var config = UIButton.Configuration.plain()
		config.image = UIImage(systemName: systemName)
		config.contentInsets = NSDirectionalEdgeInsets(top: 6, leading: 8, bottom: 6, trailing: 8)
		let btn = UIButton(configuration: config)
		btn.addTarget(self, action: action, for: .touchUpInside)
		return btn
	}

	private func loadInitialDrawing() {
		guard let data = initialDrawingData, !data.isEmpty else { return }
		if let drawing = try? PKDrawing(data: data) {
			canvasView.drawing = drawing
		}
	}

	private func setupToolPicker() {
		guard let window = view.window else { return }
		let picker = PKToolPicker.shared(for: window) ?? PKToolPicker()
		self.toolPicker = picker
		picker.addObserver(canvasView)
		picker.addObserver(self)
		picker.setVisible(true, forFirstResponder: canvasView)
		canvasView.becomeFirstResponder()
	}

	private func updateCanvasContentSize() {
		let width = max(canvasContainer.bounds.width, 320)
		let minHeight = max(canvasContainer.bounds.height * 2.0, 1200)
		let drawingMaxY = canvasView.drawing.bounds.isEmpty ? 0 : (canvasView.drawing.bounds.maxY + 240)
		let targetHeight = max(minHeight, drawingMaxY)
		if canvasView.contentSize.width != width || canvasView.contentSize.height != targetHeight {
			canvasView.contentSize = CGSize(width: width, height: targetHeight)
		}
	}

	private func clampedHeight(forRatio ratio: CGFloat, in parentHeight: CGFloat) -> CGFloat {
		let clamped = min(max(ratio, 0.40), 0.60)
		return max(parentHeight * clamped, 260)
	}

	private func notifyCurrentHeight() {
		onHeightChange(heightConstraint?.constant ?? view.bounds.height)
	}

	private func updateUndoRedoState() {
		undoButton.isEnabled = canvasView.undoManager?.canUndo ?? false
		redoButton.isEnabled = canvasView.undoManager?.canRedo ?? false
	}

	func canvasViewDrawingDidChange(_ canvasView: PKCanvasView) {
		updateUndoRedoState()
		updateCanvasContentSize()
	}

	@objc private func handleGrabberPan(_ gesture: UIPanGestureRecognizer) {
		guard let parentView = parent?.view, let constraint = heightConstraint else { return }
		let parentHeight = parentView.bounds.height
		guard parentHeight > 0 else { return }

		switch gesture.state {
		case .began:
			panStartHeight = constraint.constant
		case .changed:
			let translationY = gesture.translation(in: parentView).y
			let minH = parentHeight * 0.40
			let maxH = parentHeight * 0.60
			let nextH = min(max(panStartHeight - translationY, minH), maxH)
			constraint.constant = nextH
			heightRatio = nextH / parentHeight
			notifyCurrentHeight()
		default:
			break
		}
	}

	@objc private func handleUndo() {
		canvasView.undoManager?.undo()
		updateUndoRedoState()
	}

	@objc private func handleRedo() {
		canvasView.undoManager?.redo()
		updateUndoRedoState()
	}

	@objc private func handleClear() {
		canvasView.drawing = PKDrawing()
		updateUndoRedoState()
	}

	@objc private func handleToggleGrid() {
		paperView.showGrid.toggle()
	}

	@objc private func handleCancel() {
		dismissDrawer(cancelled: true)
	}

	@objc private func handleAttach() {
		dismissDrawer(cancelled: false)
	}

	private func encodedDrawingData() -> String? {
		let data = canvasView.drawing.dataRepresentation()
		return data.isEmpty ? nil : data.base64EncodedString()
	}

	private func renderPNG() -> String? {
		let bounds = canvasView.drawing.bounds
		guard !bounds.isEmpty else { return nil }

		let padding: CGFloat = 24
		let canvasRect = CGRect(origin: .zero, size: canvasView.contentSize)
		let exportRect = bounds.insetBy(dx: -padding, dy: -padding).intersection(canvasRect)
		guard !exportRect.isEmpty else { return nil }

		let format = UIGraphicsImageRendererFormat()
		format.scale = 2.0
		format.opaque = true
		let renderer = UIGraphicsImageRenderer(size: exportRect.size, format: format)
		let image = renderer.image { ctx in
			UIColor.white.setFill()
			ctx.fill(CGRect(origin: .zero, size: exportRect.size))
			let strokeImage = canvasView.drawing.image(from: exportRect, scale: 2.0)
			strokeImage.draw(in: CGRect(origin: .zero, size: exportRect.size))
		}
		return image.pngData()?.base64EncodedString()
	}
}

private var activeDrawer: PencilDrawerViewController?

private func findRootViewController() -> UIViewController? {
	for scene in UIApplication.shared.connectedScenes {
		guard let windowScene = scene as? UIWindowScene else { continue }
		if let window = windowScene.windows.first(where: { $0.isKeyWindow }) ?? windowScene.windows.first {
			return window.rootViewController
		}
	}
	return nil
}

public typealias LhPencilHeightCallback = @convention(c) (Double) -> Void
public typealias LhPencilCompleteCallback = @convention(c) (UnsafePointer<CChar>?, UnsafeMutableRawPointer?) -> Void
public typealias LhPencilOpenFn = @convention(c) (
	UnsafePointer<CChar>?,
	Double,
	LhPencilHeightCallback?,
	LhPencilCompleteCallback?,
	UnsafeMutableRawPointer?
) -> Void
public typealias LhPencilCloseFn = @convention(c) () -> Void

@_silgen_name("lh_pencil_register_callbacks")
private func lh_pencil_register_callbacks(_ openFn: LhPencilOpenFn, _ closeFn: LhPencilCloseFn)

@_cdecl("lh_pencil_bootstrap")
public func lh_pencil_bootstrap() {
	lh_pencil_register_callbacks(
		{ initialDrawingB64, heightRatio, onHeight, onComplete, ctx in
			lh_pencil_open_drawer(
				initialDrawingB64: initialDrawingB64,
				heightRatio: heightRatio,
				onHeight: onHeight,
				onComplete: onComplete,
				ctx: ctx
			)
		},
		{
			lh_pencil_close_drawer()
		}
	)
}

@_cdecl("lh_pencil_open_drawer")
public func lh_pencil_open_drawer(
	initialDrawingB64: UnsafePointer<CChar>?,
	heightRatio: Double,
	onHeight: LhPencilHeightCallback?,
	onComplete: LhPencilCompleteCallback?,
	ctx: UnsafeMutableRawPointer?
) {
	let initialB64 = initialDrawingB64.map { String(cString: $0) }
	let initialData = initialB64.flatMap { Data(base64Encoded: $0) }
	let ratio = CGFloat(heightRatio > 0 ? heightRatio : 0.50)

	DispatchQueue.main.async {
		if let existing = activeDrawer {
			existing.dismissDrawer(cancelled: true)
			activeDrawer = nil
		}

		guard let rootVC = findRootViewController() else {
			let payload = PencilDrawerResultPayload(cancelled: true, pngBase64: nil, drawingDataB64: initialB64, heightRatio: Double(ratio))
			if let json = try? JSONEncoder().encode(payload), let str = String(data: json, encoding: .utf8) {
				str.withCString { cstr in onComplete?(cstr, ctx) }
			} else {
				onComplete?(nil, ctx)
			}
			return
		}

		let drawer = PencilDrawerViewController(
			initialDrawingData: initialData,
			heightRatio: ratio,
			onHeightChange: { height in
				onHeight?(Double(height))
			},
			onComplete: { payload in
				activeDrawer = nil
				if let json = try? JSONEncoder().encode(payload), let str = String(data: json, encoding: .utf8) {
					str.withCString { cstr in onComplete?(cstr, ctx) }
				} else {
					onComplete?(nil, ctx)
				}
			}
		)
		activeDrawer = drawer
		drawer.attachToParent(rootVC)
	}
}

@_cdecl("lh_pencil_close_drawer")
public func lh_pencil_close_drawer() {
	DispatchQueue.main.async {
		activeDrawer?.dismissDrawer(cancelled: true)
		activeDrawer = nil
	}
}
