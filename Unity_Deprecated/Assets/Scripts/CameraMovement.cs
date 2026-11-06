
using UnityEngine;

public class CameraMovement : MonoBehaviour
{
    //Speed Settings
    public float zoomSpeed = 5f;
    public float wasdMoveSetting = 100f;
    private float wasdMoveSpeed;
    // Camera Zoom
    public float maxZoomSetting = 20f;
    public float minZoomSetting = 1f;
    private float minZoom, maxZoom;
    private float maxX, maxZ;
    // Object Storage
    public Transform targetPlane;
    private Camera orthoCamera;
    // Drag Movement
    Vector3 PreviousScreenPoint;
    Vector3 PreviousWorldPoint;


    private void Start()
    {
        orthoCamera = GetComponent<Camera>();
        maxZoom = maxZoomSetting * 150f;
        minZoom = minZoomSetting * 150f;

        wasdMoveSpeed = wasdMoveSetting * 100f;

        maxX = targetPlane.position.x + targetPlane.localScale.x * 5f;
        maxZ = targetPlane.position.z + targetPlane.localScale.z * 5f;
    }

    public void CentreCamera(Vector3 newPosition)
    {
        // Calculate the minimum and maximum bounds based on the target plane's position and size relative to the camera's orthographic size
        float cameraHeight = orthoCamera.orthographicSize;
        float cameraWidth = orthoCamera.aspect * cameraHeight;

        float boundsX = maxX - (cameraWidth * 1f);
        float boundsZ = maxZ - (cameraHeight * 1f);

        newPosition.x = Mathf.Clamp(newPosition.x, -boundsX, boundsX);
        newPosition.z = Mathf.Clamp(newPosition.z, -boundsZ, boundsZ);
        newPosition.y = transform.position.y;

        transform.position = newPosition;
    }


    private void Update()
    {
        // Calculate the minimum and maximum bounds based on the target plane's position and size relative to the camera's orthographic size
        float cameraHeight = orthoCamera.orthographicSize;
        float cameraWidth = orthoCamera.aspect * cameraHeight;

        // Calculate the safety bubble around the camera
        float boundsX = maxX - (cameraWidth * 1f);
        float boundsZ = maxZ - (cameraHeight * 1f);

        // Find and return position changes due to click and drag or wasd
        Vector3 wasdMovement = ProcessAxis();
        Vector3 dragMovement = ProcessDrag(Camera.main);

        Vector3 newPosition = transform.position + wasdMovement + dragMovement;

        newPosition.x = Mathf.Clamp(newPosition.x, -boundsX, boundsX);
        newPosition.z = Mathf.Clamp(newPosition.z, -boundsZ, boundsZ);
        newPosition.y = transform.position.y;

        transform.position = newPosition;
    }

    Vector3 ProcessAxis()
    {
        // Zooming
        float scrollInput = Input.GetAxis("Mouse ScrollWheel");
        float newZoom = orthoCamera.orthographicSize - scrollInput * zoomSpeed;
        newZoom = Mathf.Clamp(newZoom, minZoom, maxZoom);
        orthoCamera.orthographicSize = newZoom;

        // Moving with WASD
        Vector3 wasdMoveInput = new Vector3(-Input.GetAxis("Horizontal"), 0f, -Input.GetAxis("Vertical"));
        // Higher zoom go slower
        Vector3 returnPosition = wasdMoveInput * (newZoom / maxZoom) * wasdMoveSpeed * Time.deltaTime;
        return returnPosition;
    }
    Vector3 ProcessDrag(Camera viewCamera)
    {
        bool isDown = Input.GetMouseButton(2);
        bool wentDown = Input.GetMouseButtonDown(2);
        Vector3 newPosition = Vector3.zero;

        // Middle Mouse Button Drag
        Vector3 screenPosition = Input.mousePosition;
        var ray = viewCamera.ScreenPointToRay(screenPosition);

        var plane = new Plane(Vector3.up, Vector3.zero);
        float distance = 0;
        if (plane.Raycast(ray, out distance))
        {
            Vector3 worldPoint = ray.GetPoint(distance);

            if (wentDown)
            {
                // on the frame the mouse went down, by definition we didn't move at all
                PreviousWorldPoint = worldPoint;
            }

            if (isDown)
            {
                // We are dragging, how much did we move
                Vector3 worldDelta = worldPoint - PreviousWorldPoint;

                // Update the currentPosition based on the worldDelta
                newPosition = -worldDelta;

                // Recalculate the PreviousScreenPoint using the current camera position
                ray = viewCamera.ScreenPointToRay(PreviousScreenPoint);
                plane.Raycast(ray, out distance);
                PreviousWorldPoint = ray.GetPoint(distance);


            }

            PreviousWorldPoint = worldPoint;
        }

        PreviousScreenPoint = screenPosition;

        return newPosition;
    }
}