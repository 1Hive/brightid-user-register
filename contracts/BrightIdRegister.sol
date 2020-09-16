pragma solidity ^0.4.24;

import "@aragon/os/contracts/apps/AragonApp.sol";
import "@aragon/os/contracts/lib/math/SafeMath.sol";
import "./RegisterAndCall.sol";

contract BrightIdRegister is AragonApp {
    using SafeMath for uint256;

    bytes32 constant public UPDATE_SETTINGS_ROLE = keccak256("UPDATE_SETTINGS_ROLE");

    string private constant ERROR_REGISTRATION_PERIOD_ZERO = "REGISTRATION_PERIOD_ZERO";
    string private constant ERROR_SENDER_NOT_IN_VERIFICATION = "SENDER_NOT_IN_VERIFICATION";
    string private constant ERROR_INCORRECT_VERIFICATION = "INCORRECT_VERIFICATION";
    string private constant ERROR_ADDRESS_VOIDED = "ADDRESS_VOIDED";
    string private constant ERROR_NO_UNIQUE_ID_ASSIGNED = "NO_UNIQUE_ID_ASSIGNED";

    struct UserRegistration {
        address uniqueUserId;
        uint256 registerTime;
        bool addressVoid;
    }

    bytes32 public brightIdContext;
    address public brightIdVerifier;
    uint256 public registrationPeriod;
    uint256 public verificationTimestampVariance;

    mapping (address => UserRegistration) public userRegistrations;

    event Register(address sender);

    /**
    * @param _brightIdContext BrightId context used for verifying users
    * @param _brightIdVerifier BrightId verifier address that signs BrightId verifications
    * @param _registrationPeriod Length of time after a registration before registration is required again
    * @param _verificationTimestampVariance Acceptable period of time between creating a BrightId verification
    *       and registering it with the BrightIdRegister
    */
    function initialize(
        bytes32 _brightIdContext,
        address _brightIdVerifier,
        uint256 _registrationPeriod,
        uint256 _verificationTimestampVariance
    )
        public onlyInit
    {
        require(_registrationPeriod > 0, ERROR_REGISTRATION_PERIOD_ZERO);

        brightIdContext = _brightIdContext;
        brightIdVerifier = _brightIdVerifier;
        registrationPeriod = _registrationPeriod;
        verificationTimestampVariance = _verificationTimestampVariance;

        initialized();
    }

    /**
    * @notice Set the BrightId verifier address to `_brightIdVerifier`
    * @param _brightIdVerifier Address used to verify signed BrightId verifications
    */
    function setBrightIdVerifier(address _brightIdVerifier) external auth(UPDATE_SETTINGS_ROLE) {
        brightIdVerifier = _brightIdVerifier;
    }

    /**
    * @notice Set the registration period to `_registrationPeriod`
    * @param _registrationPeriod Length of time after a registration before registration is required again
    */
    function setRegistrationPeriod(uint256 _registrationPeriod) external auth(UPDATE_SETTINGS_ROLE) {
        require(_registrationPeriod > 0, ERROR_REGISTRATION_PERIOD_ZERO);
        registrationPeriod = _registrationPeriod;
    }

    /**
    * @notice Set the verification timestamp variance to `_verificationTimestampVariance`
    * @param _verificationTimestampVariance Acceptable period of time between fetching a BrightId verification
    *       and registering it with the BrightIdRegister
    */
    function setVerificationTimestampVariance(uint256 _verificationTimestampVariance) external auth(UPDATE_SETTINGS_ROLE) {
        verificationTimestampVariance = _verificationTimestampVariance;
    }

    /**
    * @notice Register the sender as a unique individual with a BrightId verification and assign the first address
    *       they registered with as their unique ID
    * @param _brightIdContext The context used in the users verification
    * @param _addrs The history of addresses, or contextIds, used by this user to register with BrightID for the _brightIdContext
    * @param _timestamp The time the verification was created by a BrightId node
    * @param _v Part of the BrightId nodes signature verifying the users uniqueness
    * @param _r Part of the BrightId nodes signature verifying the users uniqueness
    * @param _s Part of the BrightId nodes signature verifying the users uniqueness
    * @param _registerAndCall Contract to call after registration, set to 0x0 to register without forwarding data
    * @param _functionCallData Function data to call on the contract address after registration
    */
    function register(
        bytes32 _brightIdContext,
        address[] _addrs,
        uint256 _timestamp,
        uint8 _v,
        bytes32 _r,
        bytes32 _s,
        RegisterAndCall _registerAndCall,
        bytes _functionCallData
    )
        external
    {
        UserRegistration storage userRegistration = userRegistrations[msg.sender];
        require(msg.sender == _addrs[0], ERROR_SENDER_NOT_IN_VERIFICATION);
        require(_isVerifiedUnique(_brightIdContext, _addrs, _timestamp, _v, _r, _s), ERROR_INCORRECT_VERIFICATION);
        require(!userRegistration.addressVoid, ERROR_ADDRESS_VOIDED);

        userRegistration.registerTime = getTimestamp();

        address uniqueUserId = _addrs[_addrs.length - 1];  // The last address is/was the first address registered with the _brightIdContext
        if (userRegistration.uniqueUserId == address(0)) {
            userRegistration.uniqueUserId = uniqueUserId;
            _voidPreviousRegistrations(_addrs);
        }

        // We do this to ensure calls of uniqueUserId() that use the result of uniqueUserId() will
        // return the uniqueUserId even if the user has not registered their initial address
        if (userRegistrations[uniqueUserId].uniqueUserId == address(0)) {
            userRegistrations[uniqueUserId].uniqueUserId = uniqueUserId;
        }

        if (address(_registerAndCall) != address(0)) {
            _registerAndCall.receiveRegistration(userRegistration.uniqueUserId, _functionCallData);
        }

        emit Register(msg.sender);
    }

    /**
    * @notice Return whether or not the BrightId user is verified
    * @param _brightIdUser The BrightId user's address
    */
    function isVerified(address _brightIdUser) external view returns (bool) {
        UserRegistration storage userRegistration = userRegistrations[_brightIdUser];

        bool hasUniqueId = userRegistration.uniqueUserId != address(0);
        bool userRegisteredWithinPeriod = getTimestamp() < userRegistration.registerTime.add(registrationPeriod);
        bool userValid = !userRegistration.addressVoid;

        return hasUniqueId && userRegisteredWithinPeriod && userValid;
    }

    /**
    * @notice Return a users unique ID, which is the first address they registered with
    * @dev Addresses that have been used as contextId's within this context that were not registered with the
    *    BrightIdRegister will not have a unique user id set and this function will revert.
    * @param _brightIdUser The BrightId user's address
    */
    function uniqueUserId(address _brightIdUser) external view returns (address) {
        UserRegistration storage userRegistration = userRegistrations[_brightIdUser];
        require(userRegistration.uniqueUserId != address(0), ERROR_NO_UNIQUE_ID_ASSIGNED);

        return userRegistration.uniqueUserId;
    }

    function _isVerifiedUnique(
        bytes32 _brightIdContext,
        address[] memory _addrs,
        uint256 _timestamp,
        uint8 _v,
        bytes32 _r,
        bytes32 _s
    )
        internal view returns (bool)
    {
        bytes32 signedMessage = keccak256(abi.encodePacked(_brightIdContext, _addrs, _timestamp));
        address verifierAddress = ecrecover(signedMessage, _v, _r, _s);

        bool correctVerifier = brightIdVerifier == verifierAddress;
        bool correctContext = brightIdContext == _brightIdContext;
        bool acceptableTimestamp = getTimestamp() < _timestamp.add(verificationTimestampVariance);

        return correctVerifier && correctContext && acceptableTimestamp;
    }

    /**
    * @notice Void all previously used addresses to prevent users from registering multiple times using old
    *       BrightID verifications
    */
    function _voidPreviousRegistrations(address[] memory _addrs) internal {
        if (_addrs.length <= 1) {
            return;
        }

        // Loop until we find a voided user registration, from which all
        // subsequent user registrations will already be voided
        uint256 index = 1;
        while (index < _addrs.length && !userRegistrations[_addrs[index]].addressVoid) {
            userRegistrations[_addrs[index]].addressVoid = true;
            index++;
        }
    }
}
